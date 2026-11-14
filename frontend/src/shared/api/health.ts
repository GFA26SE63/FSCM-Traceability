const apiBaseUrl = import.meta.env.VITE_TRACEABILITY_API_BASE_URL ?? 'http://localhost:5080';

export async function getHealth(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/health`);
  if (!response.ok) throw new Error('Traceability API health check failed');
}
