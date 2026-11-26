using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Fscm.Traceability.Migrations
{
    /// <inheritdoc />
    public partial class AddProductionStandards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FACTORY_LINE_SKU_RULE",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductionLine = table.Column<string>(type: "character varying(1)", maxLength: 1, nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sku = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ProductName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FACTORY_LINE_SKU_RULE", x => x.Id);
                    table.CheckConstraint("CK_FACTORY_LINE_SKU_Line", "\"ProductionLine\" IN ('A','B','C','D')");
                });

            migrationBuilder.CreateTable(
                name: "FACTORY_SKU_PACKAGING_SPEC",
                columns: table => new
                {
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sku = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ProductName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    UnitsPerCarton = table.Column<int>(type: "integer", nullable: false),
                    CartonsPerPallet = table.Column<int>(type: "integer", nullable: false),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FACTORY_SKU_PACKAGING_SPEC", x => x.ProductId);
                    table.CheckConstraint("CK_FACTORY_PACKAGING_Cartons", "\"CartonsPerPallet\" BETWEEN 1 AND 100");
                    table.CheckConstraint("CK_FACTORY_PACKAGING_Units", "\"UnitsPerCarton\" BETWEEN 1 AND 1000");
                });

            migrationBuilder.CreateIndex(
                name: "IX_FACTORY_LINE_SKU_RULE_ProductionLine_ProductId",
                table: "FACTORY_LINE_SKU_RULE",
                columns: new[] { "ProductionLine", "ProductId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FACTORY_LINE_SKU_RULE");

            migrationBuilder.DropTable(
                name: "FACTORY_SKU_PACKAGING_SPEC");
        }
    }
}
