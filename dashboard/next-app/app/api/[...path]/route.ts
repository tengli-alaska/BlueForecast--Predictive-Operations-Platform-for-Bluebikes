import { NextRequest, NextResponse } from "next/server";

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:8000";

function buildTargetUrl(path: string[], searchParams: URLSearchParams): URL {
  const trimmedBase = apiBaseUrl.replace(/\/+$/, "");
  const target = new URL(`${trimmedBase}/api/${path.join("/")}`);
  searchParams.forEach((value, key) => target.searchParams.append(key, value));
  return target;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = buildTargetUrl(path, request.nextUrl.searchParams);

  try {
    const response = await fetch(target, {
      cache: "no-store",
      headers: {
        accept: request.headers.get("accept") || "application/json",
      },
    });

    const body = await response.text();
    const contentType = response.headers.get("content-type") || "application/json";

    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": contentType },
    });
  } catch {
    return NextResponse.json(
      { detail: "Backend API unavailable" },
      { status: 503 },
    );
  }
}
