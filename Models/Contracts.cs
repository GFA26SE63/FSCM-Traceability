namespace Fscm.Traceability.Models;

public sealed record DispatchedPallet(Guid PalletId, string PalletCode, Guid DestinationWarehouseId,
    DateTimeOffset? DispatchedAt, string BatchCode, string Sku, string ProductName, int CartonCount, DateOnly ExpirationDate);

public sealed record SimulateProductionRequest(string FactoryCode, string ProductionLine, Guid ProductId,
    DateOnly ProductionDate, DateOnly ExpirationDate, int PalletCount, int CartonsPerPallet, int UnitsPerCarton);
public sealed record FactoryBatchView(FactoryProductionBatch Batch, string Sku, string ProductName, FactoryPallet[] Pallets, int CartonCount, int UnitCount);
public sealed record PalletManifest(FactoryPallet Pallet, FactoryProductionBatch Batch, string Sku, string ProductName, FactoryCarton[] Cartons);
public sealed record SourceTrace(FactoryProductionBatch Batch, string Sku, FactoryPallet? Pallet, FactoryCarton? Carton,
    FactoryProductUnit? Unit, FactoryProductUnit[] Units, string[] CartonCodes, Guid[] DestinationWarehouseIds);
public sealed record ReceiptAcknowledgement(Guid PalletId, Guid ReceiptDocumentId, Guid WarehouseId, DateTimeOffset ReceivedAt, string? ReceiptInspectionJson = null);
public sealed record FscmUser(Guid Id, string Email, string FullName, string Role);
public sealed record FscmSession(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken, DateTimeOffset RefreshTokenExpiresAt, FscmUser User);
public sealed record FscmProduct(Guid Id, string Sku, string Name, string Status);
public sealed record FscmWarehouse(Guid Id, string Code, string Name, bool IsActive);
public sealed record ProductPage(FscmProduct[] Items, int TotalCount, int Page, int PageSize);
public sealed record LoginRequest(string Identifier, string Password);
public sealed record DispatchRequest(Guid DestinationWarehouseId, Guid[]? PalletIds = null);
public sealed record PalletOverview(FactoryPallet Pallet, int CartonCount, int UnitCount);
public sealed record BatchDetail(FactoryProductionBatch Batch, string Sku, string ProductName,
    PalletOverview[] Pallets, int CartonCount, int UnitCount);
public sealed record MappingRow
{
    public string BatchCode { get; init; } = "";
    public string PalletCode { get; init; } = "";
    public string CartonCode { get; init; } = "";
    public string Sku { get; init; } = "";
    public string? UnitCode { get; init; }
    public int UnitsInCarton { get; init; }
    public DateOnly ProductionDate { get; init; }
    public DateOnly ExpirationDate { get; init; }
}
public sealed record MappingPage(MappingRow[] Items, int Page, int PageSize, int TotalCount);
/// <summary>Everything printed on a whole-batch QR sheet: the batch, its pallets and (optionally) their cartons.</summary>
public sealed record BatchLabelSheet(FactoryProductionBatch Batch, string Sku, BatchLabelPallet[] Pallets, bool IncludeCartons);
public sealed record BatchLabelPallet(FactoryPallet Pallet, int CartonCount, FactoryCarton[] Cartons);

public sealed record ReadyPalletView(
    Guid PalletId,
    string PalletCode,
    Guid BatchId,
    string BatchCode,
    string Sku,
    string ProductName,
    string ProductionLine,
    DateOnly ProductionDate,
    DateOnly ExpirationDate,
    int CartonCount,
    int UnitCount
);

public sealed record CreateDispatchNoteRequest(
    Guid DestinationWarehouseId,
    Guid[] PalletIds,
    string? VehicleNumber = null,
    string? DriverName = null,
    string? Note = null
);

public sealed record FactoryDispatchNoteSummary(
    Guid Id,
    string Code,
    string FactoryCode,
    Guid DestinationWarehouseId,
    string DestinationWarehouseName,
    string? VehicleNumber,
    string? DriverName,
    string? Note,
    int PalletCount,
    int CartonCount,
    int UnitCount,
    DateTimeOffset DispatchedAt,
    string CreatedByName,
    string Status,
    string[] PalletCodes
);

public sealed record FactoryDispatchPalletItem(
    Guid PalletId,
    string PalletCode,
    string BatchCode,
    string Sku,
    string ProductName,
    DateOnly ProductionDate,
    DateOnly ExpirationDate,
    int CartonCount,
    int UnitCount,
    string Status,
    DateTimeOffset? ReceivedAt,
    string? ReceiptInspectionJson
);

public sealed record FactoryDispatchNoteDetail(
    FactoryDispatchNote Note,
    FactoryDispatchPalletItem[] Pallets,
    string Status
);

public sealed class FactoryException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
    public static FactoryException Validation(string message) => new(400, message);
    public static FactoryException NotFound(string message) => new(404, message);
    public static FactoryException Conflict(string message) => new(409, message);
}
