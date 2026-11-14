using System.Security.Claims;
using Fscm.Traceability.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Fscm.Traceability.Services;

public sealed class FactorySessionEvents(IFscmGateway fscm) : CookieAuthenticationEvents
{
    public static ClaimsPrincipal Principal(FscmUser user) => new(new ClaimsIdentity([
        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Name, user.FullName),
        new Claim(ClaimTypes.Role, user.Role)], CookieAuthenticationDefaults.AuthenticationScheme));
    public static void Store(AuthenticationProperties properties, FscmSession session) => properties.StoreTokens([
        new AuthenticationToken { Name = "access_token", Value = session.AccessToken },
        new AuthenticationToken { Name = "refresh_token", Value = session.RefreshToken }]);
    public override async Task ValidatePrincipal(CookieValidatePrincipalContext context)
    {
        try
        {
            FscmUser user;
            try { user = await fscm.MeAsync(context.Properties.GetTokenValue("access_token") ?? "", context.HttpContext.RequestAborted); }
            catch (FactoryException e) when (e.Status == 401)
            {
                var session = await fscm.RefreshAsync(context.Properties.GetTokenValue("refresh_token") ?? "", context.HttpContext.RequestAborted);
                Store(context.Properties, session); context.ShouldRenew = true;
                user = await fscm.MeAsync(session.AccessToken, context.HttpContext.RequestAborted);
            }
            if (user.Role != "Admin") { context.RejectPrincipal(); return; }
            context.ReplacePrincipal(Principal(user));
        }
        catch (FactoryException e) when (e.Status is 401 or 403) { context.RejectPrincipal(); }
    }
    public override Task RedirectToLogin(RedirectContext<CookieAuthenticationOptions> context) { context.Response.StatusCode = 401; return Task.CompletedTask; }
    public override Task RedirectToAccessDenied(RedirectContext<CookieAuthenticationOptions> context) { context.Response.StatusCode = 403; return Task.CompletedTask; }
}
