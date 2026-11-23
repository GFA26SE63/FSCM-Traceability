using ReceiptInspection = Fscm.Traceability.Models.ReceiptInspection;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Fscm.Traceability.Data;
using Fscm.Traceability.Models;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Fscm.Traceability.Services;

public sealed class ProductionService(FactoryDbContext source, IFscmGateway fscm, TimeProvider clock)
{
    public static string BatchCode(string factory, DateOnly date, string line, int sequence) => $"BID-{factory}-{date:yyyyMMdd}-{line}-{sequence:D4}";
    public static string DispatchNoteCode(string factory, DateOnly date, int sequence) => $"PXN-{factory}-{date:yyyyMMdd}-{sequence:D4}";
    public static string StockCode(string warehouse, string sku, string batch, DateOnly received, DateOnly expiry) =>
        $"{warehouse}-{sku}-{batch}-{received:yyyyMMdd}-{expiry:yyyyMMdd}";
    public static DateOnly VietnamDate(DateTimeOffset instant) => DateOnly.FromDateTime(instant.ToOffset(TimeSpan.FromHours(7)).DateTime);
    public static void Validate(SimulateProductionRequest data, DateOnly today)
    {
        if (!Regex.IsMatch(data.FactoryCode ?? "", "^[A-Z0-9]{1,12}$") || !new[] { "A", "B", "C", "D" }.Contains(data.ProductionLine))
            throw FactoryException.Validation("Mã nhà máy gồm 1–12 chữ in hoa/số; line là A, B, C hoặc D.");
        if (data.ProductionDate > today || data.ExpirationDate <= data.ProductionDate || data.ExpirationDate < today)
            throw FactoryException.Validation("NSX không ở tương lai; HSD phải sau NSX và chưa hết hạn.");
        if (data.PalletCount is < 1 or > 100 || data.CartonsPerPallet is < 1 or > 100 || data.UnitsPerCarton is < 1 or > 1000 ||
            (long)data.PalletCount * data.CartonsPerPallet > 9999 || (long)data.PalletCount * data.CartonsPerPallet * data.UnitsPerCarton > 50000)
            throw FactoryException.Validation("Mô phỏng tối đa 100 pallet, 100 carton/pallet và 50.000 sản phẩm/mẻ; tối đa 9.999 carton/mẻ.");
    }

    public async Task<FactoryBatchView[]> ListAsync(CancellationToken ct)
    {
        var batches = await source.Set<FactoryProductionBatch>().AsNoTracking().OrderByDescending(x => x.CreatedAt).Take(100).ToArrayAsync(ct);
        var ids = batches.Select(x => x.Id).ToArray();
        var pallets = await source.Set<FactoryPallet>().AsNoTracking().Where(x => ids.Contains(x.ProductionBatchId)).ToArrayAsync(ct);
        var palletIds = pallets.Select(x => x.Id).ToArray();
        var counts = await source.Set<FactoryCarton>().Where(x => palletIds.Contains(x.PalletId)).GroupBy(x => x.PalletId)
            .Select(x => new { Id = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        return batches.Select(b => {
            var ps = pallets.Where(p => p.ProductionBatchId == b.Id).OrderBy(p => p.Code).ToArray();
            var count = ps.Sum(p => counts.GetValueOrDefault(p.Id));
            return new FactoryBatchView(b, b.Sku, b.ProductName, ps, count, count * b.UnitsPerCarton);
        }).ToArray();
    }

    public async Task<BatchDetail> DetailAsync(Guid id, CancellationToken ct)
    {
        var batch = await source.Set<FactoryProductionBatch>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw FactoryException.NotFound("Không tìm thấy mẻ sản xuất.");
        var pallets = await source.Set<FactoryPallet>().AsNoTracking().Where(x => x.ProductionBatchId == id).OrderBy(x => x.Code).ToArrayAsync(ct);
        var palletIds = pallets.Select(p => p.Id).ToArray();
        var cartonCounts = await source.Set<FactoryCarton>().Where(c => palletIds.Contains(c.PalletId)).GroupBy(c => c.PalletId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        var unitCounts = await (from u in source.Set<FactoryProductUnit>()
            join c in source.Set<FactoryCarton>() on u.CartonId equals c.Id
            where palletIds.Contains(c.PalletId)
            group u by c.PalletId into g select new { Id = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        return new(batch, batch.Sku, batch.ProductName,
            pallets.Select(p => new PalletOverview(p, cartonCounts.GetValueOrDefault(p.Id), unitCounts.GetValueOrDefault(p.Id))).ToArray(),
            cartonCounts.Values.Sum(), unitCounts.Values.Sum());
    }

    /// <summary>Read-only data for the whole-batch QR sheet (codes as issued at creation).</summary>
    public async Task<BatchLabelSheet> BatchLabelsAsync(Guid id, bool includeCartons, CancellationToken ct)
    {
        var batch = await source.Set<FactoryProductionBatch>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw FactoryException.NotFound("Không tìm thấy mẻ sản xuất.");
        var pallets = await source.Set<FactoryPallet>().AsNoTracking().Where(x => x.ProductionBatchId == id).OrderBy(x => x.Code).ToArrayAsync(ct);
        var palletIds = pallets.Select(p => p.Id).ToArray();
        var cartons = await source.Set<FactoryCarton>().AsNoTracking().Where(c => palletIds.Contains(c.PalletId))
            .OrderBy(c => c.Sequence).ToArrayAsync(ct);
        var byPallet = cartons.GroupBy(c => c.PalletId).ToDictionary(g => g.Key, g => g.ToArray());
        return new(batch, batch.Sku, pallets.Select(p => {
            var own = byPallet.GetValueOrDefault(p.Id) ?? [];
            return new BatchLabelPallet(p, own.Length, includeCartons ? own : []);
        }).ToArray(), includeCartons);
    }

    public static void ValidateMappingPage(string level, int page, int pageSize)
    {
        if (level is not ("cartons" or "units") || page is < 1 or > 1000000 || pageSize is < 1 or > 200)
            throw FactoryException.Validation("Cấp xem là cartons/units; trang từ 1; tối đa 200 dòng/trang.");
    }

    // One row per carton or one row per serialized unit, preserving every parent identifier.
    public IQueryable<MappingRow> MappingQuery(Guid id, string level, string? pallet, string? carton, string? search)
    {
        var cartons = from c in source.Set<FactoryCarton>().AsNoTracking()
            join p in source.Set<FactoryPallet>().AsNoTracking() on c.PalletId equals p.Id
            join b in source.Set<FactoryProductionBatch>().AsNoTracking() on p.ProductionBatchId equals b.Id
            where b.Id == id && (pallet == null || p.Code == pallet) && (carton == null || c.Code == carton)
            select new { c.Id, CartonCode = c.Code, PalletCode = p.Code, BatchCode = b.Code, b.Sku, b.ProductionDate, b.ExpirationDate };
        var term = search?.Trim().ToUpperInvariant();
        if (level == "cartons")
        {
            // A serial (UID) search finds the carton that holds it.
            if (!string.IsNullOrEmpty(term)) cartons = cartons.Where(c => c.CartonCode.ToUpper().Contains(term) || c.PalletCode.ToUpper().Contains(term) || c.Sku.ToUpper().Contains(term)
                || source.Set<FactoryProductUnit>().Any(u => u.CartonId == c.Id && u.Code.ToUpper().Contains(term)));
            return cartons.Select(c => new MappingRow { BatchCode = c.BatchCode, PalletCode = c.PalletCode, CartonCode = c.CartonCode, Sku = c.Sku,
                UnitsInCarton = source.Set<FactoryProductUnit>().Count(u => u.CartonId == c.Id), ProductionDate = c.ProductionDate, ExpirationDate = c.ExpirationDate });
        }
        var units = from c in cartons join u in source.Set<FactoryProductUnit>().AsNoTracking() on c.Id equals u.CartonId
            select new { c.BatchCode, c.PalletCode, c.CartonCode, c.Sku, UnitCode = u.Code, c.ProductionDate, c.ExpirationDate, CartonId = c.Id };
        if (!string.IsNullOrEmpty(term)) units = units.Where(u => u.UnitCode.ToUpper().Contains(term) || u.CartonCode.ToUpper().Contains(term) || u.PalletCode.ToUpper().Contains(term) || u.Sku.ToUpper().Contains(term));
        return units.Select(u => new MappingRow { BatchCode = u.BatchCode, PalletCode = u.PalletCode, CartonCode = u.CartonCode, Sku = u.Sku, UnitCode = u.UnitCode,
            UnitsInCarton = source.Set<FactoryProductUnit>().Count(x => x.CartonId == u.CartonId), ProductionDate = u.ProductionDate, ExpirationDate = u.ExpirationDate });
    }

    public async Task<MappingPage> MappingAsync(Guid id, string level, string? pallet, string? carton, string? search, int page, int pageSize, CancellationToken ct)
    {
        ValidateMappingPage(level, page, pageSize);
        if (!await source.Set<FactoryProductionBatch>().AnyAsync(x => x.Id == id, ct)) throw FactoryException.NotFound("Không tìm thấy mẻ sản xuất.");
        var rows = MappingQuery(id, level, pallet, carton, search);
        var count = await rows.CountAsync(ct);
        var ordered = rows.OrderBy(x => x.PalletCode).ThenBy(x => x.CartonCode);
        if (level == "units") ordered = ordered.ThenBy(x => x.UnitCode);
        var items = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(ct);
        return new(items, page, pageSize, count);
    }

    public async Task<Guid> SimulateAsync(SimulateProductionRequest data, string key, Guid actor, string accessToken, CancellationToken ct)
    {
        Validate(data, VietnamDate(clock.GetUtcNow()));
        if (string.IsNullOrWhiteSpace(key) || key.Length > 100) throw FactoryException.Validation("Idempotency-Key cần 1–100 ký tự.");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { actor, data }))));
        return await Atomic(async () => {
            var previous = await source.Set<FactoryProductionBatch>().SingleOrDefaultAsync(x => x.OperationKey == key, ct);
            if (previous is not null)
            {
                if (previous.RequestHash != hash) throw FactoryException.Conflict("Khóa thao tác đã dùng cho nội dung khác.");
                return previous.Id;
            }
            var product = await fscm.ProductAsync(data.ProductId, accessToken, ct);
            if (product.Status != "Published") throw FactoryException.Validation("Chọn SKU đang phát hành.");
            // Serializable isolation + unique key protects a daily sequence across all four lines.
            var sequence = (await source.Set<FactoryProductionBatch>().Where(x => x.FactoryCode == data.FactoryCode && x.ProductionDate == data.ProductionDate)
                .MaxAsync(x => (int?)x.DailySequence, ct) ?? 0) + 1;
            if (sequence > 9999) throw FactoryException.Conflict("Đã hết dải 4 số cho ngày sản xuất này.");
            var batch = new FactoryProductionBatch { Id = Guid.NewGuid(), Code = BatchCode(data.FactoryCode, data.ProductionDate, data.ProductionLine, sequence),
                FactoryCode = data.FactoryCode, ProductionLine = data.ProductionLine, DailySequence = sequence, ProductId = product.Id, Sku = product.Sku, ProductName = product.Name,
                ProductionDate = data.ProductionDate, ExpirationDate = data.ExpirationDate, UnitsPerCarton = data.UnitsPerCarton,
                OperationKey = key, RequestHash = hash, CreatedByUserId = actor, CreatedAt = clock.GetUtcNow() };
            source.Add(batch);
            var identity = batch.Code[4..];
            var cartonSequence = 0; var unitSequence = 0;
            for (var p = 1; p <= data.PalletCount; p++)
            {
                var pallet = new FactoryPallet { Id = Guid.NewGuid(), ProductionBatchId = batch.Id, Code = $"PID-{identity}-{p:D4}" };
                source.Add(pallet);
                for (var c = 0; c < data.CartonsPerPallet; c++)
                {
                    var carton = new FactoryCarton { Id = Guid.NewGuid(), PalletId = pallet.Id, Sequence = ++cartonSequence, Code = $"CID-{identity}-{cartonSequence:D4}" };
                    source.Add(carton);
                    for (var u = 0; u < data.UnitsPerCarton; u++)
                        source.Add(new FactoryProductUnit { Id = Guid.NewGuid(), CartonId = carton.Id, Sequence = ++unitSequence,
                            Code = $"UID-{identity}-{unitSequence:D6}" });
                }
            }
            await source.SaveChangesAsync(ct); return batch.Id;
        }, ct);
    }

    public async Task<ReadyPalletView[]> ReadyPalletsAsync(CancellationToken ct)
    {
        var pallets = await (from p in source.Set<FactoryPallet>().AsNoTracking()
                             join b in source.Set<FactoryProductionBatch>().AsNoTracking() on p.ProductionBatchId equals b.Id
                             where p.Status == "Packed"
                             orderby b.ProductionDate descending, b.DailySequence descending, p.Code
                             select new
                             {
                                 Pallet = p,
                                 Batch = b
                             }).Take(200).ToArrayAsync(ct);

        if (pallets.Length == 0) return [];
        var palletIds = pallets.Select(x => x.Pallet.Id).ToArray();
        var cartonCounts = await source.Set<FactoryCarton>().Where(c => palletIds.Contains(c.PalletId)).GroupBy(c => c.PalletId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);

        return pallets.Select(x =>
        {
            var cCount = cartonCounts.GetValueOrDefault(x.Pallet.Id);
            return new ReadyPalletView(
                x.Pallet.Id,
                x.Pallet.Code,
                x.Batch.Id,
                x.Batch.Code,
                x.Batch.Sku,
                x.Batch.ProductName,
                x.Batch.ProductionLine,
                x.Batch.ProductionDate,
                x.Batch.ExpirationDate,
                cCount,
                cCount * x.Batch.UnitsPerCarton
            );
        }).ToArray();
    }

    public Task<FactoryDispatchNoteSummary> CreateDispatchNoteAsync(CreateDispatchNoteRequest request, Guid actorId, string actorName, string accessToken, CancellationToken ct) => AtomicResult(async () =>
    {
        if (request.PalletIds == null || request.PalletIds.Length == 0)
            throw FactoryException.Validation("Chọn ít nhất một pallet để lập phiếu xuất kho.");
        if (request.PalletIds.Distinct().Count() != request.PalletIds.Length)
            throw FactoryException.Validation("Danh sách pallet chọn không được trùng lặp.");
        RequireTransport(request.VehicleNumber, request.DriverName);

        var warehouse = await fscm.WarehouseAsync(request.DestinationWarehouseId, accessToken, ct);
        if (!warehouse.IsActive)
            throw FactoryException.Validation("Kho nhận hàng không hoạt động hoặc không tồn tại.");

        var pallets = await source.Set<FactoryPallet>().Where(x => request.PalletIds.Contains(x.Id)).ToArrayAsync(ct);
        if (pallets.Length != request.PalletIds.Length)
            throw FactoryException.NotFound("Một số pallet không tìm thấy trong hệ thống.");

        if (pallets.Any(x => x.Status != "Packed"))
            throw FactoryException.Conflict("Chỉ có thể xuất các pallet ở trạng thái 'Đã đóng pallet' (Packed). Có pallet đã phát hành.");

        var batchIds = pallets.Select(p => p.ProductionBatchId).Distinct().ToArray();
        var batches = await source.Set<FactoryProductionBatch>().AsNoTracking().Where(b => batchIds.Contains(b.Id)).ToDictionaryAsync(b => b.Id, ct);

        var palletIds = pallets.Select(p => p.Id).ToArray();
        var cartonCounts = await source.Set<FactoryCarton>().Where(c => palletIds.Contains(c.PalletId)).GroupBy(c => c.PalletId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);

        var totalCartons = 0;
        var totalUnits = 0;
        foreach (var p in pallets)
        {
            var b = batches[p.ProductionBatchId];
            var cCount = cartonCounts.GetValueOrDefault(p.Id);
            totalCartons += cCount;
            totalUnits += cCount * b.UnitsPerCarton;
        }

        var factoryCode = batches.Values.First().FactoryCode;
        var today = VietnamDate(clock.GetUtcNow());

        var prefix = $"PXN-{factoryCode}-{today:yyyyMMdd}-";
        var maxExisting = await source.Set<FactoryDispatchNote>()
            .Where(d => d.FactoryCode == factoryCode && d.Code.StartsWith(prefix))
            .Select(d => d.Code)
            .ToArrayAsync(ct);

        var nextSeq = 1;
        foreach (var code in maxExisting)
        {
            if (code.Length > prefix.Length && int.TryParse(code[prefix.Length..], out var s) && s >= nextSeq)
                nextSeq = s + 1;
        }

        var noteCode = DispatchNoteCode(factoryCode, today, nextSeq);
        var now = clock.GetUtcNow();
        var palletCodes = pallets.OrderBy(p => p.Code).Select(p => p.Code).ToArray();

        var dispatchNote = new FactoryDispatchNote
        {
            Id = Guid.NewGuid(),
            Code = noteCode,
            FactoryCode = factoryCode,
            DestinationWarehouseId = request.DestinationWarehouseId,
            DestinationWarehouseName = warehouse.Name,
            VehicleNumber = string.IsNullOrWhiteSpace(request.VehicleNumber) ? null : request.VehicleNumber.Trim(),
            DriverName = string.IsNullOrWhiteSpace(request.DriverName) ? null : request.DriverName.Trim(),
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            PalletCount = pallets.Length,
            CartonCount = totalCartons,
            UnitCount = totalUnits,
            DispatchedAt = now,
            CreatedByUserId = actorId,
            CreatedByName = actorName,
            PalletCodesJson = JsonSerializer.Serialize(palletCodes)
        };
        source.Add(dispatchNote);

        foreach (var p in pallets)
        {
            p.Status = "Dispatched";
            p.DestinationWarehouseId = request.DestinationWarehouseId;
            p.DispatchedAt = now;
            p.DispatchNoteId = dispatchNote.Id;
            p.DispatchCode = dispatchNote.Code;
            p.Version++;
        }

        await source.SaveChangesAsync(ct);

        return new FactoryDispatchNoteSummary(
            dispatchNote.Id,
            dispatchNote.Code,
            dispatchNote.FactoryCode,
            dispatchNote.DestinationWarehouseId,
            dispatchNote.DestinationWarehouseName,
            dispatchNote.VehicleNumber,
            dispatchNote.DriverName,
            dispatchNote.Note,
            dispatchNote.PalletCount,
            dispatchNote.CartonCount,
            dispatchNote.UnitCount,
            dispatchNote.DispatchedAt,
            dispatchNote.CreatedByName,
            "Dispatched",
            palletCodes
        );
    }, ct);

    public async Task<FactoryDispatchNoteSummary[]> ListDispatchNotesAsync(CancellationToken ct)
    {
        var notes = await source.Set<FactoryDispatchNote>().AsNoTracking()
            .OrderByDescending(x => x.DispatchedAt)
            .Take(100)
            .ToArrayAsync(ct);

        if (notes.Length == 0) return [];
        var noteIds = notes.Select(n => n.Id).ToArray();

        var palletStatuses = await source.Set<FactoryPallet>().AsNoTracking()
            .Where(p => p.DispatchNoteId.HasValue && noteIds.Contains(p.DispatchNoteId.Value))
            .Select(p => new { NoteId = p.DispatchNoteId!.Value, p.Status })
            .ToArrayAsync(ct);

        var statusesByNote = palletStatuses.GroupBy(x => x.NoteId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Status).ToArray());

        return notes.Select(n =>
        {
            var pStatuses = statusesByNote.GetValueOrDefault(n.Id) ?? [];
            string noteStatus;
            if (pStatuses.Length > 0 && pStatuses.All(s => s == "Received")) noteStatus = "Received";
            else if (pStatuses.Any(s => s == "Received")) noteStatus = "PartiallyReceived";
            else noteStatus = "Dispatched";

            string[] palletCodes = [];
            try { palletCodes = JsonSerializer.Deserialize<string[]>(n.PalletCodesJson) ?? []; } catch { }

            return new FactoryDispatchNoteSummary(
                n.Id, n.Code, n.FactoryCode, n.DestinationWarehouseId, n.DestinationWarehouseName,
                n.VehicleNumber, n.DriverName, n.Note, n.PalletCount, n.CartonCount, n.UnitCount,
                n.DispatchedAt, n.CreatedByName, noteStatus, palletCodes
            );
        }).ToArray();
    }

    public async Task<FactoryDispatchNoteDetail> DispatchNoteDetailAsync(Guid id, CancellationToken ct)
    {
        var note = await source.Set<FactoryDispatchNote>().AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw FactoryException.NotFound("Không tìm thấy phiếu xuất xưởng.");

        var pallets = await (from p in source.Set<FactoryPallet>().AsNoTracking()
                             join b in source.Set<FactoryProductionBatch>().AsNoTracking() on p.ProductionBatchId equals b.Id
                             where p.DispatchNoteId == id || p.DispatchCode == note.Code
                             orderby p.Code
                             select new { Pallet = p, Batch = b }).ToArrayAsync(ct);

        var palletIds = pallets.Select(x => x.Pallet.Id).ToArray();
        var cartonCounts = await source.Set<FactoryCarton>().Where(c => palletIds.Contains(c.PalletId)).GroupBy(c => c.PalletId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);

        var items = pallets.Select(x =>
        {
            var cCount = cartonCounts.GetValueOrDefault(x.Pallet.Id);
            return new FactoryDispatchPalletItem(
                x.Pallet.Id,
                x.Pallet.Code,
                x.Batch.Code,
                x.Batch.Sku,
                x.Batch.ProductName,
                x.Batch.ProductionDate,
                x.Batch.ExpirationDate,
                cCount,
                cCount * x.Batch.UnitsPerCarton,
                x.Pallet.Status,
                x.Pallet.ReceivedAt,
                x.Pallet.ReceiptInspectionJson
            );
        }).ToArray();

        string status;
        if (items.Length > 0 && items.All(i => i.Status == "Received")) status = "Received";
        else if (items.Any(i => i.Status == "Received")) status = "PartiallyReceived";
        else status = "Dispatched";

        return new FactoryDispatchNoteDetail(note, items, status);
    }

    /// <summary>Every dispatch (from the batch dialog or the PXN page) must name the vehicle and the driver.</summary>
    public static void RequireTransport(string? vehicleNumber, string? driverName)
    {
        if (string.IsNullOrWhiteSpace(vehicleNumber) || vehicleNumber.Trim().Length > 50)
            throw FactoryException.Validation("Nhập biển số xe vận chuyển (tối đa 50 ký tự).");
        if (string.IsNullOrWhiteSpace(driverName) || driverName.Trim().Length > 100)
            throw FactoryException.Validation("Nhập tên tài xế / người vận chuyển (tối đa 100 ký tự).");
    }

    public Task<Guid> DispatchAsync(Guid batchId, Guid destination, string accessToken, CancellationToken ct, Guid[]? palletIds = null,
        string? vehicleNumber = null, string? driverName = null, string? note = null) => Atomic(async () => {
        RequireTransport(vehicleNumber, driverName);
        if (note?.Trim().Length > 200) throw FactoryException.Validation("Ghi chú xuất xưởng tối đa 200 ký tự.");
        var warehouse = await fscm.WarehouseAsync(destination, accessToken, ct);
        if (!warehouse.IsActive)
            throw FactoryException.Validation("Kho đích không hoạt động.");
        if (palletIds is not null && (palletIds.Length == 0 || palletIds.Distinct().Count() != palletIds.Length))
            throw FactoryException.Validation("Chọn ít nhất một pallet, không trùng mã.");
        var pallets = await source.Set<FactoryPallet>().Where(x => x.ProductionBatchId == batchId && (palletIds == null || palletIds.Contains(x.Id))).ToArrayAsync(ct);
        if (palletIds is not null && pallets.Length != palletIds.Length)
            throw FactoryException.Validation("Pallet đã chọn không thuộc mẻ này.");
        if (pallets.Length == 0) throw FactoryException.NotFound("Không tìm thấy batch nhà máy.");
        if (pallets.All(x => x.Status != "Packed" && x.DestinationWarehouseId == destination)) return batchId;
        if (pallets.Any(x => x.Status != "Packed")) throw FactoryException.Conflict("Pallet đã phát hành; không đổi kho đích. Chỉ chọn pallet chưa xuất.");

        var batch = await source.Set<FactoryProductionBatch>().AsNoTracking().SingleAsync(b => b.Id == batchId, ct);
        var pIds = pallets.Select(p => p.Id).ToArray();
        var cartonCounts = await source.Set<FactoryCarton>().Where(c => pIds.Contains(c.PalletId)).GroupBy(c => c.PalletId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        var totalCartons = pallets.Sum(p => cartonCounts.GetValueOrDefault(p.Id));
        var totalUnits = totalCartons * batch.UnitsPerCarton;

        var today = VietnamDate(clock.GetUtcNow());
        var prefix = $"PXN-{batch.FactoryCode}-{today:yyyyMMdd}-";
        var maxExisting = await source.Set<FactoryDispatchNote>()
            .Where(d => d.FactoryCode == batch.FactoryCode && d.Code.StartsWith(prefix))
            .Select(d => d.Code).ToArrayAsync(ct);
        var nextSeq = 1;
        foreach (var code in maxExisting)
        {
            if (code.Length > prefix.Length && int.TryParse(code[prefix.Length..], out var s) && s >= nextSeq) nextSeq = s + 1;
        }
        var now = clock.GetUtcNow();
        var dispatchNote = new FactoryDispatchNote
        {
            Id = Guid.NewGuid(),
            Code = DispatchNoteCode(batch.FactoryCode, today, nextSeq),
            FactoryCode = batch.FactoryCode,
            DestinationWarehouseId = destination,
            DestinationWarehouseName = warehouse.Name,
            VehicleNumber = vehicleNumber!.Trim(),
            DriverName = driverName!.Trim(),
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            PalletCount = pallets.Length,
            CartonCount = totalCartons,
            UnitCount = totalUnits,
            DispatchedAt = now,
            CreatedByUserId = batch.CreatedByUserId,
            CreatedByName = "Admin",
            PalletCodesJson = JsonSerializer.Serialize(pallets.OrderBy(p => p.Code).Select(p => p.Code).ToArray())
        };
        source.Add(dispatchNote);

        foreach (var p in pallets) {
            p.Status = "Dispatched";
            p.DestinationWarehouseId = destination;
            p.DispatchedAt = now;
            p.DispatchNoteId = dispatchNote.Id;
            p.DispatchCode = dispatchNote.Code;
            p.Version++;
        }
        await source.SaveChangesAsync(ct); return batchId;
    }, ct);

    // The receipt module consumes a manifest; it never guesses the contents from the QR string.
    public IQueryable<DispatchedPallet> DispatchedQuery(Guid[] warehouseIds) =>
        from pallet in source.Set<FactoryPallet>().AsNoTracking()
        join batch in source.Set<FactoryProductionBatch>().AsNoTracking() on pallet.ProductionBatchId equals batch.Id
        join note in source.Set<FactoryDispatchNote>().AsNoTracking() on pallet.DispatchNoteId equals note.Id into notes
        from note in notes.DefaultIfEmpty()
        where pallet.Status == "Dispatched" && pallet.DestinationWarehouseId.HasValue
            && warehouseIds.Contains(pallet.DestinationWarehouseId.Value)
        orderby pallet.DispatchedAt, pallet.Code
        select new DispatchedPallet(pallet.Id, pallet.Code, pallet.DestinationWarehouseId!.Value,
            pallet.DispatchedAt, batch.Code, batch.Sku, batch.ProductName,
            source.Set<FactoryCarton>().Count(c => c.PalletId == pallet.Id), batch.ExpirationDate,
            pallet.DispatchNoteId, note != null ? note.Code : pallet.DispatchCode,
            note != null ? note.VehicleNumber : null, note != null ? note.DriverName : null);

    public Task<DispatchedPallet[]> DispatchedAsync(Guid[] warehouseIds, CancellationToken ct)
    {
        if (warehouseIds.Length is < 1 or > 500 || warehouseIds.Contains(Guid.Empty))
            throw FactoryException.Validation("Cần danh sách kho nhận hợp lệ (tối đa 500 kho).");
        return DispatchedQuery(warehouseIds.Distinct().ToArray()).ToArrayAsync(ct);
    }

    public async Task<PalletManifest> ManifestAsync(string code, CancellationToken ct)
    {
        var pallet = await source.Set<FactoryPallet>().AsNoTracking().SingleOrDefaultAsync(x => x.Code == code, ct)
            ?? throw FactoryException.NotFound("Không tìm thấy pallet trong traceability nhà máy.");
        var batch = await source.Set<FactoryProductionBatch>().AsNoTracking().SingleAsync(x => x.Id == pallet.ProductionBatchId, ct);
        return new(pallet, batch, batch.Sku, batch.ProductName, await source.Set<FactoryCarton>().AsNoTracking().Where(x => x.PalletId == pallet.Id).OrderBy(x => x.Sequence).ToArrayAsync(ct));
    }

    public async Task<SourceTrace> TraceAsync(string code, CancellationToken ct)
    {
        code = code.Trim();
        var unit = await source.Set<FactoryProductUnit>().AsNoTracking().SingleOrDefaultAsync(x => x.Code == code, ct);
        var cartonId = unit?.CartonId;
        var carton = await source.Set<FactoryCarton>().AsNoTracking().SingleOrDefaultAsync(x => x.Code == code || x.Id == cartonId, ct);
        var palletId = carton?.PalletId;
        var pallet = await source.Set<FactoryPallet>().AsNoTracking().SingleOrDefaultAsync(x => x.Code == code || x.Id == palletId, ct);
        var batchId = pallet?.ProductionBatchId;
        var batch = await source.Set<FactoryProductionBatch>().AsNoTracking().SingleOrDefaultAsync(x => x.Code == code || x.Id == batchId, ct)
            ?? throw FactoryException.NotFound("Không tìm thấy mã traceability.");
        var selectedPalletId = pallet?.Id;
        var pallets = source.Set<FactoryPallet>().Where(x => x.ProductionBatchId == batch.Id && (selectedPalletId == null || x.Id == selectedPalletId));
        var codes = carton is not null ? new[] { carton.Code } : await source.Set<FactoryCarton>()
            .Where(c => pallets.Any(p => p.Id == c.PalletId)).Select(c => c.Code).ToArrayAsync(ct);
        var destinations = await pallets.Where(p => p.DestinationWarehouseId.HasValue).Select(p => p.DestinationWarehouseId!.Value).Distinct().ToArrayAsync(ct);
        var units = carton is null ? [] : await source.Set<FactoryProductUnit>().AsNoTracking().Where(x => x.CartonId == carton.Id).OrderBy(x => x.Sequence).ToArrayAsync(ct);
        return new(batch, batch.Sku, pallet, carton, unit, units, codes, destinations);
    }

    public Task<Guid> AcknowledgeReceiptAsync(ReceiptAcknowledgement receipt, CancellationToken ct) => Atomic(async () => {
        var pallet = await source.Set<FactoryPallet>().SingleOrDefaultAsync(x => x.Id == receipt.PalletId, ct)
            ?? throw FactoryException.NotFound("Không tìm thấy pallet gốc để đồng bộ nhận.");
        string? inspectionJson = null;
        if (receipt.ReceiptInspectionJson is not null) {
            var codes = await source.Set<FactoryCarton>().Where(x => x.PalletId == pallet.Id).Select(x => x.Code).ToArrayAsync(ct);
            try { inspectionJson = ReceiptInspection.Normalize(codes, ReceiptInspection.Read(receipt.ReceiptInspectionJson)); }
            catch (Exception e) when (e is ArgumentException or System.Text.Json.JsonException) { throw FactoryException.Conflict("Biên bản kiểm đếm không hợp lệ."); }
        }
        if (pallet.Status == "Received" && pallet.ReceiptDocumentId == receipt.ReceiptDocumentId && pallet.DestinationWarehouseId == receipt.WarehouseId) {
            if (pallet.ReceiptInspectionJson != inspectionJson) throw FactoryException.Conflict("ACK khác kết quả đã nhận.");
            return pallet.Id;
        }
        if (pallet.Status != "Dispatched" || pallet.DestinationWarehouseId != receipt.WarehouseId)
            throw FactoryException.Conflict("Thông tin nhận pallet không khớp chuyến nhà máy.");
        pallet.Status = "Received"; pallet.ReceiptDocumentId = receipt.ReceiptDocumentId;
        pallet.ReceivedAt = receipt.ReceivedAt; pallet.ReceiptInspectionJson = inspectionJson; pallet.Version++;
        await source.SaveChangesAsync(ct); return pallet.Id;
    }, ct);

    private Task<Guid> Atomic(Func<Task<Guid>> action, CancellationToken ct) => AtomicResult(action, ct);

    private async Task<T> AtomicResult<T>(Func<Task<T>> action, CancellationToken ct)
    {
        try { return await source.Database.CreateExecutionStrategy().ExecuteAsync(async () => {
            source.ChangeTracker.Clear();
            await using var tx = await source.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var result = await action(); await tx.CommitAsync(ct); return result;
        }); }
        catch (PostgresException e) when (e.SqlState is PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected)
        { throw FactoryException.Conflict("Có thao tác đồng thời; tải lại và quét/thử lại. Không cộng tồn hai lần."); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected })
        { throw FactoryException.Conflict("Có thao tác đồng thời; tải lại và quét/thử lại. Không cộng tồn hai lần."); }
        catch (DbUpdateConcurrencyException) { throw FactoryException.Conflict("Dữ liệu đã thay đổi, tải lại rồi thử lại."); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        { throw FactoryException.Conflict("Mã hoặc khóa thao tác đã tồn tại; thử lại cùng khóa thao tác."); }
    }
}
