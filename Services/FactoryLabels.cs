using System.Net;
using System.Text;
using Fscm.Traceability.Models;
using QRCoder;

namespace Fscm.Traceability.Services;

public static class FactoryLabels
{
    private static string Start => "<!doctype html><html lang='vi'><meta charset='utf-8'><title>Nhãn traceability</title><link rel='stylesheet' href='/labels.css'><button id='print'>In nhãn</button><script src='/print.js' defer></script>";
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
    public static string Units(SourceTrace trace)
    {
        if (trace.Carton is null) throw FactoryException.Validation("Chọn một carton để in serial.");
        var html = new StringBuilder(Start);
        foreach (var unit in trace.Units) Label(html, unit.Code, "SẢN PHẨM · " + trace.Carton.Code, trace.Sku, trace.Batch);
        return html.Append("</html>").ToString();
    }
}
