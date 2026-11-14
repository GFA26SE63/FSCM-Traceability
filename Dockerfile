FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY FSCM.Traceability.csproj ./
RUN dotnet restore FSCM.Traceability.csproj
COPY . ./
RUN dotnet publish FSCM.Traceability.csproj -c Release --no-restore -o /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
RUN mkdir -p /keys && chown app:app /keys
COPY --from=build /out ./
ENV ASPNETCORE_HTTP_PORTS=8080
ENV DataProtection__KeyPath=/keys
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "FSCM.Traceability.dll"]
