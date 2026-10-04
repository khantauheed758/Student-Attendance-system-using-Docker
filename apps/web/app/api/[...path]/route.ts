import { NextRequest, NextResponse } from "next/server";
async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const upstream = `${process.env.API_INTERNAL_URL || "http://localhost:4000"}/api/${path.join("/")}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(req.method)) body = await req.arrayBuffer();
  const r = await fetch(upstream, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
  });
  const out = new NextResponse(r.body, {
    status: r.status,
    statusText: r.statusText,
  });
  r.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "content-encoding") out.headers.set(k, v);
  });
  return out;
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const PUT = proxy;
