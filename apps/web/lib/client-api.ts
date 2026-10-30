"use client";

/** Bound network waits, including body reads, while preserving caller cancellation. */
export function requestSignal(signal?: AbortSignal | null, timeoutMs = 30_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function requestJSON<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs, ...request } = init;
  const signal = requestSignal(request.signal, timeoutMs);
  try {
    const response = await fetch(path, {
      ...request, signal, credentials: "same-origin", cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(typeof body?.detail === "string" ? body.detail : "Não foi possível concluir a operação. Tente novamente.");
    return body as T;
  } catch (error) {
    if (signal.aborted && !request.signal?.aborted)
      throw new Error("A conexão demorou demais. Confira sua conexão e tente novamente.");
    if (error instanceof SyntaxError)
      throw new Error("O serviço retornou uma resposta inválida. Tente novamente.");
    throw error;
  }
}

export function isAborted(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
export function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "A conexão demorou demais. Tente novamente.";
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}
export function waitForPoll(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
