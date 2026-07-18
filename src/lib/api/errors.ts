import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, status: number, message?: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message: message ?? code } }, { status });
}
