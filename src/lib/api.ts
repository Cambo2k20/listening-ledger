export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  return readApiResponse<T>(response)
}

export async function apiFile<T>(
  path: string,
  file: File,
  options?: Omit<RequestInit, 'body'>,
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    method: options?.method ?? 'POST',
    body: file,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-History-File-Name': encodeURIComponent(file.name),
      ...options?.headers,
    },
  })
  return readApiResponse<T>(response)
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null
  if (!response.ok) {
    throw new ApiError(
      (payload as { error?: string } | null)?.error ??
        `Request failed with ${response.status}.`,
      response.status,
    )
  }
  return payload as T
}
