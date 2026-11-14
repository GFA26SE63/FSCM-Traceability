using System.Net;
using System.Net.Http.Headers;
using Fscm.Traceability.Models;

namespace Fscm.Traceability.Services;

public interface IFscmGateway
{
    Task<FscmSession> LoginAsync(LoginRequest request, CancellationToken ct);
    Task<FscmSession> RefreshAsync(string token, CancellationToken ct);
    Task<FscmUser> MeAsync(string accessToken, CancellationToken ct);
    Task<FscmProduct> ProductAsync(Guid id, string accessToken, CancellationToken ct);
    Task<FscmWarehouse> WarehouseAsync(Guid id, string accessToken, CancellationToken ct);
    Task<FscmProduct[]> ProductsAsync(string accessToken, CancellationToken ct);
    Task<FscmWarehouse[]> WarehousesAsync(string accessToken, CancellationToken ct);
}

public sealed class FscmGateway(HttpClient http) : IFscmGateway
{
    private async Task<T> Send<T>(HttpMethod method, string path, object? body, string? token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            throw new FactoryException(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden ? (int)response.StatusCode : 502,
                "FSCM từ chối yêu cầu hoặc không khả dụng. Kiểm tra tài khoản và kết nối FSCM.");
        return await response.Content.ReadFromJsonAsync<T>(ct) ?? throw new FactoryException(502, "FSCM trả dữ liệu không hợp lệ.");
    }
    public Task<FscmSession> LoginAsync(LoginRequest request, CancellationToken ct) => Send<FscmSession>(HttpMethod.Post, "api/v1/auth/login", request, null, ct);
    public Task<FscmSession> RefreshAsync(string token, CancellationToken ct) => Send<FscmSession>(HttpMethod.Post, "api/v1/auth/refresh", new { refreshToken = token }, null, ct);
    public Task<FscmUser> MeAsync(string token, CancellationToken ct) => Send<FscmUser>(HttpMethod.Get, "api/v1/auth/me", null, token, ct);
    public Task<FscmProduct> ProductAsync(Guid id, string token, CancellationToken ct) => Send<FscmProduct>(HttpMethod.Get, $"api/v1/products/{id}", null, token, ct);
    public Task<FscmWarehouse> WarehouseAsync(Guid id, string token, CancellationToken ct) => Send<FscmWarehouse>(HttpMethod.Get, $"api/v1/warehouses/{id}", null, token, ct);
    public async Task<FscmProduct[]> ProductsAsync(string token, CancellationToken ct)
    {
        var all = new List<FscmProduct>(); var page = 1;
        while (true)
        {
            var result = await Send<ProductPage>(HttpMethod.Get, $"api/v1/products?status=Published&page={page}&pageSize=100", null, token, ct);
            all.AddRange(result.Items);
            if (result.Items.Length == 0 || all.Count >= result.TotalCount) break;
            page++;
            if (page > 1000) throw new FactoryException(502, "Danh mục FSCM vượt giới hạn phân trang.");
        }
        return all.ToArray();
    }
    public Task<FscmWarehouse[]> WarehousesAsync(string token, CancellationToken ct) => Send<FscmWarehouse[]>(HttpMethod.Get, "api/v1/warehouses", null, token, ct);
}
