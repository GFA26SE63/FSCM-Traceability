# FSCM Traceability — ứng dụng nhà máy deploy riêng

Project tự build/publish, không có ProjectReference hoặc source-link đến FSCM. Giao diện và API nhà máy được phục vụ cùng một domain/process. Chỉ kết nối DB `fscm_traceability`; không có connection string DB kho. Hai ứng dụng tích hợp bằng HTTP.

## Chạy local

```powershell
dotnet run --project "C:\Users\Thien\Downloads\CapstoneProject\PackageCode\FSCM-Traceability" --launch-profile http
```

Mở http://localhost:5250/ và đăng nhập bằng Admin FSCM. Backend FSCM local phải chạy ở http://localhost:5246/ để đăng nhập và lấy SKU/kho. Sau khi đã có dữ liệu sản xuất, các endpoint tích hợp manifest/ACK chỉ cần DB nhà máy và khóa dịch vụ, không gọi ngược FSCM.

`appsettings.Local.json` là cấu hình cục bộ đã git-ignore; không publish file đó. Chỉnh URL/kết nối bằng biến môi trường khi deploy.

## Cấu hình deploy

| Ứng dụng | Biến môi trường | Giá trị |
|---|---|---|
| Traceability | `ConnectionStrings__TraceabilityConnection` | Kết nối DB `fscm_traceability` |
| Traceability | `Fscm__BaseUrl` | Origin API FSCM, có dấu `/` cuối, dùng HTTPS khi deploy |
| Traceability | `Integration__ApiKey` | Khóa dịch vụ ngẫu nhiên, tối thiểu 32 ký tự |
| Traceability | `DataProtection__KeyPath` | Thư mục persistent cho khóa cookie; App Service Windows dùng `D:\home\site\keys`, Docker dùng `/keys` |
| FSCM | `Traceability__BaseUrl` | Origin API traceability, có dấu `/` cuối |
| FSCM | `Traceability__PublicUrl` | URL giao diện traceability để mở từ FSCM |
| FSCM | `Traceability__ApiKey` | Cùng khóa dịch vụ phía traceability |

Không cấu hình DB kho hoặc JWT signing secret trong traceability. Đăng nhập/kiểm tra tài khoản qua API FSCM; token được giữ trong cookie mã hóa HttpOnly của nhà máy, không trả token cho JavaScript hoặc lưu localStorage. API đăng nhập giới hạn tần suất; thao tác giao diện yêu cầu custom header để chặn form cross-site. Endpoint dịch vụ dùng khóa riêng và so sánh constant time. Chỉ expose HTTPS khi deploy để cookie Secure hoạt động.

### Docker / hosting container khác (tùy chọn)

**Build context chính là thư mục này**, không cần build backend FSCM:

```powershell
docker build -t fscm-traceability .
```

Cấp các biến môi trường ở bảng trên, mount persistent volume `/keys`, expose cổng container `8080`, đặt health probe `/health` và readiness `/health/ready`. Có thể deploy image này thành Azure Container App / Web App for Containers riêng, hoặc hosting container tương đương; domain và lịch deploy độc lập FSCM.

Compose mẫu nhận env qua file cục bộ `factory.local.env` (không commit). Nếu chạy Production cần reverse proxy HTTPS trước cổng 5250; để thử HTTP local đặt `ASPNETCORE_ENVIRONMENT=Development`.

```powershell
docker compose --env-file factory.local.env up -d --build
```

For Azure App Service Windows code deployment, see
[`docs/deployment/azure-app-service.md`](docs/deployment/azure-app-service.md).

### Migration và dữ liệu đã có

Project giữ nguyên ID migration `InitialFactoryDatabase` đã áp dụng và giữ nguyên tên bảng/ID/BID/PID/CID/UID. Không tạo database thay thế hoặc reset dữ liệu.

```powershell
dotnet run --project . -- --migrate
```

Hoặc với container đã có env/volume:

```powershell
docker compose --env-file factory.local.env run --rm traceability --migrate
```

Chạy migration một lần trước khi bật replica mới. Với schema hiện tại, migration nhận biết lịch sử đã áp dụng và không tạo lại bảng.

## API

- Giao diện quản trị: `/api/session/login`, `/api/session`, `/api/catalog/products`, `/api/catalog/warehouses`, `/api/batches`, `/api/batches/simulate`, `/api/batches/{id}/dispatch`, `/api/pallets/{code}/manifest`, in nhãn theo pallet/carton, `/api/trace`.
- FSCM → traceability: `GET /api/integration/pallets/{code}/manifest`, `GET /api/integration/trace?code=...`, `POST /api/integration/receipts`; mọi request cần `X-Traceability-Key`.
- Traceability → FSCM: đăng nhập/refresh/me và đọc catalog products/warehouses bằng token của người dùng. Không có browser CORS trực tiếp giữa hai app.
- FSCM ghi snapshot manifest/tồn/phiếu/outbox trong một giao dịch ở DB kho. Worker gửi ACK qua HTTP và retry; replay không cộng tồn và không nhận lại pallet.

Project hiện vẫn lưu trong cùng repository để review và giữ lịch sử thay đổi; thư mục này có thể đưa sang repository khác nguyên vẹn vì không phụ thuộc source ngoài thư mục. Chưa tạo tài nguyên hosting hoặc deploy image lên server.

## Quy định UI: chi tiết mở bằng popup

Màn có danh sách (mẻ, pallet, carton, kết quả tra cứu…) mà mỗi mục có thể xem chi tiết thì mỗi mục phải có nút **"Xem chi tiết"**; bấm vào mở popup (`<dialog>` với `showModal()`, như `batch-dialog`). **Không** hiển thị chi tiết thành khối mới ở cuối trang hay chèn bên dưới danh sách. Popup có nút "Đóng" và đóng được bằng phím Esc. Khi thêm màn mới, theo đúng mẫu `openBatch` trong `wwwroot/app.js`.

## In mã QR cho mẻ sản xuất

Khi tạo mẻ (`POST /api/batches/simulate`), hệ thống cấp sẵn toàn bộ mã BID / PID / CID / UID trong cùng giao dịch; không có bước sinh mã riêng. Nhãn QR in từ chính các mã đã cấp, không cấp lại mã:

| Nhãn | Endpoint (chỉ giao diện Admin) | Nút trên giao diện |
|---|---|---|
| Cả mẻ: QR batch + QR từng pallet | `GET /api/batches/{id}/labels` | "In QR mẻ" ở danh sách mẻ; "In QR mẻ (batch + pallet)" trong popup chi tiết |
| Cả mẻ, kèm QR từng carton | `GET /api/batches/{id}/labels?cartons=true` | "In QR đầy đủ (kèm carton)" trong popup chi tiết |
| Một pallet: QR batch + pallet + carton của pallet | `GET /api/pallets/{code}/labels` | "In QR" ở bảng pallet |
| Serial sản phẩm của một carton | `GET /api/cartons/{code}/unit-labels` | "In QR sản phẩm" ở bảng carton |

Các endpoint in nhãn chỉ đọc DB nhà máy, không đổi schema và không thuộc API tích hợp `/api/integration/*` với FSCM.

## Xem lại mẻ và mapping

Nút Xem chi tiết mở dialog riêng, tải metadata trực tiếp từ database theo ID (không dựa vào danh sách 100 mẻ gần nhất). Dialog có bảng pallet và tổng carton/sản phẩm, tab Carton và Serial sản phẩm. Chọn Xem carton ở pallet, Xem serial ở carton, hoặc tìm PID/CID/UID/SKU; bảng phân trang 50 dòng và giữ đúng chuỗi batch–pallet–carton. URL hash lưu mẻ và bộ lọc để tải lại trang vẫn xem đúng dữ liệu. Tra cứu BID cũ rồi chọn Mở chi tiết mẻ và mapping cũng mở được mẻ ngoài danh sách gần đây.

API đọc mới: `GET /api/batches/{id}` và `GET /api/batches/{id}/mapping?level=cartons|units&pallet=...&carton=...&search=...&page=1&pageSize=50`. Không thay schema, không sinh lại mã. Sau cập nhật phải restart API rồi Ctrl+F5 để nạp JS mới. Script `scripts/Restart-Traceability.ps1` ở repo FSCM chỉ dừng đúng instance traceability ở cổng 5250 sau khi xác minh executable thuộc project; không dừng các process .NET khác.

Chạy regression giao diện (Node có sẵn, không cần npm install): `node --test tests/batch-details.test.cjs`.

## Source layout and deployment entry point

The active production simulator, receipt inspection protocol, database migrations and web UI are in the root project `FSCM.Traceability.csproj`. Publish this project to deploy it as App Service code; Docker remains an optional hosting path. This app serves its UI and API together, uses the separate traceability database, and integrates with FSCM over HTTP.

The repository contains only the active root application; deployment builds from this directory.
