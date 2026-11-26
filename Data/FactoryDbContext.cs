using Fscm.Traceability.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Fscm.Traceability.Data;

public sealed class FactoryDbContext(DbContextOptions<FactoryDbContext> options) : DbContext(options)
{
    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<DateTimeOffset>().HaveConversion<UtcConverter>();
        builder.Properties<DateTimeOffset?>().HaveConversion<UtcConverter>();
    }
    private sealed class UtcConverter() : ValueConverter<DateTimeOffset, DateTimeOffset>(x => x.ToUniversalTime(), x => x);
    protected override void OnModelCreating(ModelBuilder model)
    {
        var b = model.Entity<FactoryProductionBatch>();
        b.ToTable("FACTORY_PRODUCTION_BATCH", t => {
            t.HasCheckConstraint("CK_FACTORY_BATCH_Dates", "\"ProductionDate\" < \"ExpirationDate\"");
            t.HasCheckConstraint("CK_FACTORY_BATCH_Line", "\"ProductionLine\" IN ('A','B','C','D')");
            t.HasCheckConstraint("CK_FACTORY_BATCH_Count", "\"DailySequence\" BETWEEN 1 AND 9999 AND \"UnitsPerCarton\" > 0");
        });
        b.HasKey(x => x.Id); b.Property(x => x.Code).HasMaxLength(80); b.Property(x => x.FactoryCode).HasMaxLength(12);
        b.Property(x => x.Sku).HasMaxLength(50); b.Property(x => x.ProductName).HasMaxLength(300);
        b.Property(x => x.ProductionLine).HasMaxLength(1); b.Property(x => x.OperationKey).HasMaxLength(100); b.Property(x => x.RequestHash).HasMaxLength(64);
        b.HasIndex(x => x.Code).IsUnique(); b.HasIndex(x => x.OperationKey).IsUnique();
        b.HasIndex(x => new { x.FactoryCode, x.ProductionDate, x.DailySequence }).IsUnique();
        var p = model.Entity<FactoryPallet>();
        p.ToTable("FACTORY_PALLET", t => t.HasCheckConstraint("CK_FACTORY_PALLET_Status", "\"Status\" IN ('Packed','Dispatched','Received')"));
        p.HasKey(x => x.Id); p.Property(x => x.Code).HasMaxLength(100); p.Property(x => x.Version).IsConcurrencyToken();
        p.Property(x => x.DispatchCode).HasMaxLength(80);
        p.HasIndex(x => x.Code).IsUnique();
        p.HasIndex(x => x.DispatchNoteId);
        p.HasOne<FactoryProductionBatch>().WithMany().HasForeignKey(x => x.ProductionBatchId).OnDelete(DeleteBehavior.Restrict);
        p.HasOne<FactoryDispatchNote>().WithMany().HasForeignKey(x => x.DispatchNoteId).OnDelete(DeleteBehavior.SetNull);
        var d = model.Entity<FactoryDispatchNote>();
        d.ToTable("FACTORY_DISPATCH_NOTE");
        d.HasKey(x => x.Id);
        d.Property(x => x.Code).HasMaxLength(80);
        d.HasIndex(x => x.Code).IsUnique();
        d.Property(x => x.FactoryCode).HasMaxLength(12);
        d.Property(x => x.DestinationWarehouseName).HasMaxLength(200);
        d.Property(x => x.VehicleNumber).HasMaxLength(50);
        d.Property(x => x.DriverName).HasMaxLength(100);
        d.Property(x => x.CreatedByName).HasMaxLength(150);
        var c = model.Entity<FactoryCarton>();
        c.ToTable("FACTORY_CARTON"); c.HasKey(x => x.Id); c.Property(x => x.Code).HasMaxLength(120); c.HasIndex(x => x.Code).IsUnique();
        c.HasOne<FactoryPallet>().WithMany().HasForeignKey(x => x.PalletId).OnDelete(DeleteBehavior.Restrict);
        var u = model.Entity<FactoryProductUnit>();
        u.ToTable("FACTORY_PRODUCT_UNIT"); u.HasKey(x => x.Id); u.Property(x => x.Code).HasMaxLength(160); u.HasIndex(x => x.Code).IsUnique();
        u.HasOne<FactoryCarton>().WithMany().HasForeignKey(x => x.CartonId).OnDelete(DeleteBehavior.Restrict);
        var spec = model.Entity<FactorySkuPackagingSpec>();
        spec.ToTable("FACTORY_SKU_PACKAGING_SPEC", t => {
            t.HasCheckConstraint("CK_FACTORY_PACKAGING_Units", "\"UnitsPerCarton\" BETWEEN 1 AND 1000");
            t.HasCheckConstraint("CK_FACTORY_PACKAGING_Cartons", "\"CartonsPerPallet\" BETWEEN 1 AND 100");
        });
        spec.HasKey(x => x.ProductId);
        spec.Property(x => x.Sku).HasMaxLength(50);
        spec.Property(x => x.ProductName).HasMaxLength(300);
        var rule = model.Entity<FactoryLineSkuRule>();
        rule.ToTable("FACTORY_LINE_SKU_RULE", t =>
            t.HasCheckConstraint("CK_FACTORY_LINE_SKU_Line", "\"ProductionLine\" IN ('A','B','C','D')"));
        rule.HasKey(x => x.Id);
        rule.Property(x => x.ProductionLine).HasMaxLength(1);
        rule.Property(x => x.Sku).HasMaxLength(50);
        rule.Property(x => x.ProductName).HasMaxLength(300);
        rule.HasIndex(x => new { x.ProductionLine, x.ProductId }).IsUnique();
    }
}
