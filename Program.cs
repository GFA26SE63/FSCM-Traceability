using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Fscm.Traceability.Data;
using Fscm.Traceability.Models;
using Fscm.Traceability.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Fscm.Traceability;

public sealed class Program
{
    public static async Task Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Configuration.AddJsonFile("appsettings.Local.json", true).AddEnvironmentVariables();
        builder.Services.AddDbContext<FactoryDbContext>((sp, options) => options.UseNpgsql(
            sp.GetRequiredService<IConfiguration>().GetConnectionString("TraceabilityConnection")
                ?? throw new InvalidOperationException("Set ConnectionStrings__TraceabilityConnection."), npgsql => npgsql.EnableRetryOnFailure()));
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddScoped<ProductionService>();
        builder.Services.AddHttpClient<IFscmGateway, FscmGateway>((sp, http) => {
            http.BaseAddress = new Uri(sp.GetRequiredService<IConfiguration>()["Fscm:BaseUrl"] ?? throw new InvalidOperationException("Set Fscm__BaseUrl."));
            http.Timeout = TimeSpan.FromSeconds(20);
        });
        builder.Services.AddScoped<FactorySessionEvents>();
        var protection = builder.Services.AddDataProtection().SetApplicationName("FSCM.Traceability.Standalone");
        if (builder.Configuration["DataProtection:KeyPath"] is { Length: > 0 } keyPath)
            protection.PersistKeysToFileSystem(new DirectoryInfo(keyPath));
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options => {
            options.Cookie.Name = "fscm_factory_session";
            options.Cookie.HttpOnly = true; options.Cookie.SameSite = SameSiteMode.Strict;
            options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.EventsType = typeof(FactorySessionEvents);
        });
        builder.Services.AddAuthorization(options => options.AddPolicy("FactoryAdmin", p => p.RequireAuthenticatedUser().RequireRole("Admin")));
        builder.Services.AddRateLimiter(options => options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
        var app = builder.Build();
        if (args.Contains("--migrate"))
        {
            await using var scope = app.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<FactoryDbContext>().Database.MigrateAsync();
            Console.WriteLine("TRACEABILITY MIGRATION OK"); return;
        }
        app.Use(async (context, next) => {
            try
            {
                if (context.Request.Path.StartsWithSegments("/api") && !context.Request.Path.StartsWithSegments("/api/integration") &&
                    HttpMethods.IsPost(context.Request.Method) && context.Request.Headers["X-Requested-With"] != "Traceability")
                { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { message = "Thiếu xác nhận yêu cầu từ giao diện traceability." }); return; }
                await next();
            }
            catch (FactoryException error) { context.Response.StatusCode = error.Status; await context.Response.WriteAsJsonAsync(new { message = error.Message }); }
            catch (HttpRequestException) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { message = "Không kết nối được FSCM. Thử lại sau." }); }
            catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested) { context.Response.StatusCode = 503; await context.Response.WriteAsJsonAsync(new { message = "Dịch vụ FSCM phản hồi quá thời gian chờ." }); }
        });
        app.UseDefaultFiles(); app.UseStaticFiles(); app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();
        app.MapGet("/health", () => Results.Ok(new { service = "FSCM.Traceability", status = "running" }));
        app.MapGet("/health/ready", async (FactoryDbContext db, CancellationToken ct) =>
            await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
        app.MapPost("/api/session/login", async (LoginRequest request, HttpContext context, IFscmGateway gateway, CancellationToken ct) => {
            var session = await gateway.LoginAsync(request, ct);
            if (session.User.Role != "Admin") return Results.Json(new { message = "Chỉ Admin được vận hành nhà máy." }, statusCode: 403);
            var properties = new AuthenticationProperties(); FactorySessionEvents.Store(properties, session);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, FactorySessionEvents.Principal(session.User), properties);
            return Results.Ok(session.User);
        }).RequireRateLimiting("login");
        var admin = app.MapGroup("/api").RequireAuthorization("FactoryAdmin");
        admin.MapGet("/session", (HttpContext c) => new { name = c.User.Identity!.Name });
        admin.MapPost("/session/logout", async (HttpContext c) => { await c.SignOutAsync(); return Results.NoContent(); });
        admin.MapGet("/catalog/products", async (HttpContext c, IFscmGateway gateway, CancellationToken ct) => await gateway.ProductsAsync(await Token(c), ct));
        admin.MapGet("/catalog/warehouses", async (HttpContext c, IFscmGateway gateway, CancellationToken ct) => await gateway.WarehousesAsync(await Token(c), ct));
        admin.MapGet("/batches", (ProductionService service, CancellationToken ct) => service.ListAsync(ct));
        admin.MapGet("/batches/{id:guid}", (Guid id, ProductionService service, CancellationToken ct) => service.DetailAsync(id, ct));
        admin.MapGet("/batches/{id:guid}/mapping", (Guid id, ProductionService service, CancellationToken ct,
            string level = "cartons", string? pallet = null, string? carton = null, string? search = null, int page = 1, int pageSize = 50) =>
            service.MappingAsync(id, level, pallet, carton, search, page, pageSize, ct));
        admin.MapPost("/batches/simulate", async (SimulateProductionRequest request, HttpContext c, ProductionService service, CancellationToken ct) =>
            new { id = await service.SimulateAsync(request, c.Request.Headers["Idempotency-Key"].ToString(), Guid.Parse(c.User.FindFirstValue(ClaimTypes.NameIdentifier)!), await Token(c), ct) });
        admin.MapPost("/batches/{id:guid}/dispatch", async (Guid id, DispatchRequest request, HttpContext c, ProductionService service, CancellationToken ct) =>
            new { id = await service.DispatchAsync(id, request.DestinationWarehouseId, await Token(c), ct, request.PalletIds) });
        admin.MapGet("/pallets/{code}/manifest", (string code, ProductionService service, CancellationToken ct) => service.ManifestAsync(code, ct));
        admin.MapGet("/pallets/{code}/labels", async (string code, ProductionService service, CancellationToken ct) => Results.Content(FactoryLabels.Pallet(await service.ManifestAsync(code, ct)), "text/html; charset=utf-8"));
        admin.MapGet("/cartons/{code}/unit-labels", async (string code, ProductionService service, CancellationToken ct) => Results.Content(FactoryLabels.Units(await service.TraceAsync(code, ct)), "text/html; charset=utf-8"));
        admin.MapGet("/trace", (string code, ProductionService service, CancellationToken ct) => service.TraceAsync(code, ct));
        var integration = app.MapGroup("/api/integration").AddEndpointFilter(async (context, next) => {
            var secret = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>()["Integration:ApiKey"];
            var supplied = context.HttpContext.Request.Headers["X-Traceability-Key"].ToString();
            if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32 || !CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(secret)), SHA256.HashData(Encoding.UTF8.GetBytes(supplied)))) return Results.Unauthorized();
            return await next(context);
        });
        integration.MapGet("/pallets/{code}/manifest", (string code, ProductionService service, CancellationToken ct) => service.ManifestAsync(code, ct));
        integration.MapGet("/dispatches", ([Microsoft.AspNetCore.Mvc.FromQuery] Guid[] warehouseIds,
            ProductionService service, CancellationToken ct) => service.DispatchedAsync(warehouseIds, ct));
        integration.MapGet("/trace", (string code, ProductionService service, CancellationToken ct) => service.TraceAsync(code, ct));
        integration.MapPost("/receipts", async (ReceiptAcknowledgement receipt, ProductionService service, CancellationToken ct) =>
            new { id = await service.AcknowledgeReceiptAsync(receipt, ct), receipt.ReceiptInspectionJson });
        await app.RunAsync();
    }
    private static async Task<string> Token(HttpContext context) => (await context.AuthenticateAsync()).Properties?.GetTokenValue("access_token") ?? "";
}
