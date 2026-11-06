import { NextResponse, type NextRequest } from "next/server";
import { checkAccess } from "@/lib/access";

export async function proxy(request: NextRequest) {
  const result = await checkAccess(request.headers);
  if (!result.ok) {
    return new NextResponse(result.message, {
      status: result.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = {
  // Static build assets carry no data; the health check is probed from the host itself.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health).*)"],
};
