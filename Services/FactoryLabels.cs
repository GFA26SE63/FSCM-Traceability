using System.Net;
using System.Text;
using Fscm.Traceability.Models;
using QRCoder;

namespace Fscm.Traceability.Services;

public static class FactoryLabels
{
    // Print button sits in its own toolbar row above the labels and is hidden when printing.
    private static string Start => "<!doctype html><html lang='vi'><meta charset='utf-8'><title>Nhãn traceability</title><link rel='stylesheet' href='/labels.css?v=toolbar-1'><div class='print-toolbar'><button id='print' class='primary' type='button'>In nhãn</button></div><script src='/print.js' defer></script>";
    private static void Label(StringBuilder html, string code, string level, string sku, FactoryProductionBatch batch)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(code, QRCodeGenerator.ECCLevel.Q);
        using var qr = new SvgQRCode(data);
        html.Append($"<article><b>{WebUtility.HtmlEncode(level)}</b>{qr.GetGraphic(5)}<small>{WebUtility.HtmlEncode(code)}</small><p>SKU {WebUtility.HtmlEncode(sku)}</p><p>Batch {WebUtility.HtmlEncode(batch.Code)}</p><p>NSX {batch.ProductionDate:dd/MM/yyyy} · HSD {batch.ExpirationDate:dd/MM/yyyy}</p></article>");
    }
    public static string Pallet(PalletManifest manifest)
    {
        var html = new StringBuilder(Start);
        Label(html, manifest.Batch.Code, "BATCH NHÀ MÁY", manifest.Sku, manifest.Batch);
        Label(html, manifest.Pallet.Code, $"PALLET · {manifest.Cartons.Length} carton", manifest.Sku, manifest.Batch);
        foreach (var carton in manifest.Cartons) Label(html, carton.Code, $"CARTON · {manifest.Batch.UnitsPerCarton} sản phẩm", manifest.Sku, manifest.Batch);
        return html.Append("</html>").ToString();
    }
    /// <summary>
    /// Whole-batch sheet: the batch QR, one QR per pallet and, when asked, every carton QR grouped
    /// under its pallet. Codes are the ones issued when the batch was created; nothing is re-issued.
    /// </summary>
    public static string Batch(BatchLabelSheet sheet)
    {
        var html = new StringBuilder(Start);
        var cartons = sheet.Pallets.Sum(p => p.CartonCount);
        Label(html, sheet.Batch.Code, $"BATCH NHÀ MÁY · {sheet.Pallets.Length} pallet · {cartons} carton", sheet.Sku, sheet.Batch);
        foreach (var pallet in sheet.Pallets)
        {
            Label(html, pallet.Pallet.Code, $"PALLET · {pallet.CartonCount} carton", sheet.Sku, sheet.Batch);
            if (!sheet.IncludeCartons) continue;
            foreach (var carton in pallet.Cartons)
                Label(html, carton.Code, $"CARTON · {sheet.Batch.UnitsPerCarton} sản phẩm", sheet.Sku, sheet.Batch);
        }
        return html.Append("</html>").ToString();
    }
    public static string Units(SourceTrace trace)
    {
        if (trace.Carton is null) throw FactoryException.Validation("Chọn một carton để in serial.");
        var html = new StringBuilder(Start);
        foreach (var unit in trace.Units) Label(html, unit.Code, "SẢN PHẨM · " + trace.Carton.Code, trace.Sku, trace.Batch);
        return html.Append("</html>").ToString();
    }

    public static string DispatchNote(FactoryDispatchNoteDetail detail)
    {
        var n = detail.Note;
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(n.Code, QRCodeGenerator.ECCLevel.Q);
        using var qr = new SvgQRCode(data);
        var qrSvg = qr.GetGraphic(4);

        var sb = new StringBuilder();
        sb.Append($@"<!doctype html>
<html lang='vi'>
<head>
  <meta charset='utf-8'>
  <title>Phiếu xuất xưởng · {WebUtility.HtmlEncode(n.Code)}</title>
  <style>
    @media screen {{
      body {{ background: #f0f4f5; padding: 20px; font-family: Arial, sans-serif; }}
      .note-container {{ max-width: 900px; margin: 0 auto; background: #fff; padding: 36px 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 8px; }}
    }}
    @media print {{
      body {{ background: #fff; padding: 0; font-family: Arial, sans-serif; font-size: 13px; }}
      .note-container {{ width: 100%; max-width: none; padding: 10px; box-shadow: none; }}
      .no-print {{ display: none !important; }}
    }}
    .print-bar {{ display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 20px; max-width: 900px; margin-left: auto; margin-right: auto; }}
    .header-layout {{ display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #102f38; padding-bottom: 16px; margin-bottom: 20px; }}
    .company-col h2 {{ margin: 0 0 6px 0; font-size: 15px; color: #102f38; text-transform: uppercase; }}
    .company-col p {{ margin: 3px 0; font-size: 12px; color: #445; }}
    .meta-col {{ display: flex; align-items: center; gap: 16px; text-align: right; }}
    .qr-frame {{ width: 84px; height: 84px; }}
    .meta-col svg {{ width: 84px; height: 84px; display: block; }}
    .title-block {{ text-align: center; margin: 24px 0 20px; }}
    .title-block h1 {{ margin: 0 0 6px 0; font-size: 21px; color: #102f38; letter-spacing: 0.5px; text-transform: uppercase; }}
    .title-block .doc-subtitle {{ font-style: italic; color: #556; font-size: 13px; }}
    .title-block .doc-date {{ margin-top: 6px; font-size: 13px; color: #223; }}
    .info-table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }}
    .info-table td {{ padding: 6px 8px; vertical-align: top; }}
    .data-table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }}
    .data-table th, .data-table td {{ border: 1px solid #c2d0d4; padding: 8px 10px; text-align: left; }}
    .data-table th {{ background: #f2f7f8; color: #102f38; font-weight: bold; }}
    .text-center {{ text-align: center !important; }}
    .text-right {{ text-align: right !important; }}
    .total-row td {{ font-weight: bold; background: #fafcfc; }}
    .sign-section {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center; margin-top: 36px; page-break-inside: avoid; }}
    .sign-box strong {{ display: block; font-size: 13px; text-transform: uppercase; margin-bottom: 4px; }}
    .sign-box small {{ font-style: italic; color: #667; display: block; margin-bottom: 60px; font-size: 11px; }}
    .sign-box .sign-name {{ font-weight: 600; font-size: 13px; }}
    button.btn-print {{ display: inline-flex; align-items: center; justify-content: center; text-align: center; line-height: 1.2; background: #087d69; color: white; border: none; padding: 10px 22px; font-size: 14px; font-weight: 600; border-radius: 6px; cursor: pointer; }}
    button.btn-print:hover {{ background: #066756; }}
  </style>
</head>
<body>
  <div class='no-print print-bar'>
    <button class='btn-print' type='button' onclick='window.print()'>In Phiếu Xuất Xưởng (A4)</button>
  </div>
  <div class='note-container'>
    <div class='header-layout'>
      <div class='company-col'>
        <h2>CÔNG TY CỔ PHẦN CHUỖI CUNG ỨNG THỰC PHẨM FSCM</h2>
        <p><strong>Nhà máy sản xuất {WebUtility.HtmlEncode(n.FactoryCode)}</strong> · Chi nhánh chế biến & đóng gói thành phẩm</p>
        <p>Địa chỉ: Khu Công Nghiệp Sóng Thần, TP. Dĩ An, Tỉnh Bình Dương</p>
        <p>Điện thoại: 1900 6868 · Email: factory.{WebUtility.HtmlEncode(n.FactoryCode.ToLowerInvariant())}@fscm.vn</p>
      </div>
      <div class='meta-col'>
        <div>
          <div style='font-weight: bold; color: #102f38; font-size: 14px;'>Mẫu số: 02-VT/FSCM</div>
          <div style='margin-top: 4px;'>Số: <b>{WebUtility.HtmlEncode(n.Code)}</b></div>
        </div>
        <div class='qr-frame'>{qrSvg}</div>
      </div>
    </div>

    <div class='title-block'>
      <h1>PHIẾU XUẤT XƯỞNG KIÊM VẬN CHUYỂN NỘI BỘ</h1>
      <div class='doc-subtitle'>Xuất điều chuyển thành phẩm đóng gói đến kho trung chuyển phân phối</div>
      <div class='doc-date'>Thời gian lập phiếu: {n.DispatchedAt.ToOffset(TimeSpan.FromHours(7)):dd/MM/yyyy HH:mm} (Giờ Việt Nam)</div>
    </div>

    <table class='info-table'>
      <tr>
        <td style='width: 50%;'><strong>Kho xuất hàng:</strong> Nhà máy {WebUtility.HtmlEncode(n.FactoryCode)} (FSCM Factory)</td>
        <td style='width: 50%;'><strong>Kho tiếp nhận:</strong> <span style='font-size: 14px; font-weight: bold; color: #087d69;'>{WebUtility.HtmlEncode(n.DestinationWarehouseName)}</span></td>
      </tr>
      <tr>
        <td><strong>Phương tiện vận chuyển:</strong> {WebUtility.HtmlEncode(n.VehicleNumber ?? "Xe tải thùng kín chuyên dụng")}</td>
        <td><strong>Tài xế / Người vận chuyển:</strong> {WebUtility.HtmlEncode(n.DriverName ?? "Đội vận tải FSCM Logistics")}</td>
      </tr>
      <tr>
        <td colspan='2'><strong>Lý do xuất:</strong> Xuất thành phẩm đóng gói đạt chuẩn kiểm tra chất lượng từ nhà máy đến kho phân phối</td>
      </tr>
      {(string.IsNullOrWhiteSpace(n.Note) ? "" : $"<tr><td colspan='2'><strong>Ghi chú:</strong> {WebUtility.HtmlEncode(n.Note)}</td></tr>")}
    </table>

    <table class='data-table'>
      <thead>
        <tr>
          <th class='text-center' style='width: 40px;'>STT</th>
          <th>Mã Pallet (PID)</th>
          <th>Mã Mẻ (BID)</th>
          <th>SKU · Tên sản phẩm</th>
          <th class='text-center'>NSX / HSD</th>
          <th class='text-right'>Số thùng</th>
          <th class='text-right'>Số lượng SP</th>
          <th class='text-center'>Trạng thái</th>
        </tr>
      </thead>
      <tbody>");

        int stt = 1;
        foreach (var p in detail.Pallets)
        {
            var pStatusText = p.Status == "Received" ? "Đã nhận kho" : "Đang giao";
            sb.Append($@"
        <tr>
          <td class='text-center'>{stt++}</td>
          <td><code>{WebUtility.HtmlEncode(p.PalletCode)}</code></td>
          <td><code>{WebUtility.HtmlEncode(p.BatchCode)}</code></td>
          <td><strong>{WebUtility.HtmlEncode(p.Sku)}</strong> · {WebUtility.HtmlEncode(p.ProductName)}</td>
          <td class='text-center'>{p.ProductionDate:dd/MM/yy} - {p.ExpirationDate:dd/MM/yy}</td>
          <td class='text-right'>{p.CartonCount:N0}</td>
          <td class='text-right'>{p.UnitCount:N0}</td>
          <td class='text-center'>{pStatusText}</td>
        </tr>");
        }

        sb.Append($@"
        <tr class='total-row'>
          <td colspan='5' class='text-right'>TỔNG CỘNG ({detail.Pallets.Length} Pallet):</td>
          <td class='text-right'>{detail.Note.CartonCount:N0} thùng</td>
          <td class='text-right'>{detail.Note.UnitCount:N0} SP</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <div class='sign-section'>
      <div class='sign-box'>
        <strong>Người lập phiếu</strong>
        <small>(Ký, ghi rõ họ tên)</small>
        <div class='sign-name'>{WebUtility.HtmlEncode(n.CreatedByName)}</div>
      </div>
      <div class='sign-box'>
        <strong>Thủ kho xuất xưởng</strong>
        <small>(Ký, ghi rõ họ tên)</small>
        <div class='sign-name'>Thủ kho Nhà máy</div>
      </div>
      <div class='sign-box'>
        <strong>Người vận chuyển</strong>
        <small>(Ký, ghi rõ họ tên)</small>
        <div class='sign-name'>{WebUtility.HtmlEncode(n.DriverName ?? "Lái xe")}</div>
      </div>
      <div class='sign-box'>
        <strong>Thủ kho nhận hàng</strong>
        <small>(Ký khi nhận đủ)</small>
        <div class='sign-name'>Thủ kho {WebUtility.HtmlEncode(n.DestinationWarehouseName)}</div>
      </div>
    </div>
  </div>
</body>
</html>");

        return sb.ToString();
    }
}
