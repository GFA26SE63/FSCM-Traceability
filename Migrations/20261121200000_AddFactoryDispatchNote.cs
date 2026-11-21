using System;
using Fscm.Traceability.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Fscm.Traceability.Migrations;

[DbContext(typeof(FactoryDbContext))]
[Migration("20261121200000_AddFactoryDispatchNote")]
public sealed class AddFactoryDispatchNote : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "FACTORY_DISPATCH_NOTE",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                FactoryCode = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                DestinationWarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                DestinationWarehouseName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                VehicleNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                DriverName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                Note = table.Column<string>(type: "text", nullable: true),
                PalletCount = table.Column<int>(type: "integer", nullable: false),
                CartonCount = table.Column<int>(type: "integer", nullable: false),
                UnitCount = table.Column<int>(type: "integer", nullable: false),
                DispatchedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                CreatedByName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                PalletCodesJson = table.Column<string>(type: "text", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_FACTORY_DISPATCH_NOTE", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_FACTORY_DISPATCH_NOTE_Code",
            table: "FACTORY_DISPATCH_NOTE",
            column: "Code",
            unique: true);

        migrationBuilder.AddColumn<Guid>(
            name: "DispatchNoteId",
            table: "FACTORY_PALLET",
            type: "uuid",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "DispatchCode",
            table: "FACTORY_PALLET",
            type: "character varying(80)",
            maxLength: 80,
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_FACTORY_PALLET_DispatchNoteId",
            table: "FACTORY_PALLET",
            column: "DispatchNoteId");

        migrationBuilder.AddForeignKey(
            name: "FK_FACTORY_PALLET_FACTORY_DISPATCH_NOTE_DispatchNoteId",
            table: "FACTORY_PALLET",
            column: "DispatchNoteId",
            principalTable: "FACTORY_DISPATCH_NOTE",
            principalColumn: "Id",
            onDelete: ReferentialAction.SetNull);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_FACTORY_PALLET_FACTORY_DISPATCH_NOTE_DispatchNoteId",
            table: "FACTORY_PALLET");

        migrationBuilder.DropIndex(
            name: "IX_FACTORY_PALLET_DispatchNoteId",
            table: "FACTORY_PALLET");

        migrationBuilder.DropColumn(
            name: "DispatchNoteId",
            table: "FACTORY_PALLET");

        migrationBuilder.DropColumn(
            name: "DispatchCode",
            table: "FACTORY_PALLET");

        migrationBuilder.DropTable(
            name: "FACTORY_DISPATCH_NOTE");
    }
}
