import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "unblurr_session";
const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "unblurr-dev-secret-change-me-in-production"
);

async function getSession(token?: string): Promise<{ role: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return { role: (payload.role as string) || "user" };
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await getSession(req.cookies.get(SESSION_COOKIE)?.value);

  const redirect = (to: string) => NextResponse.redirect(new URL(to, req.url));

  // Main tool requires a session
  if (pathname === "/" && !session) {
    return redirect("/login?next=/");
  }

  // Auth pages: if already signed in, go home
  if ((pathname === "/login" || pathname === "/signup") && session) {
    return redirect("/");
  }

  // Admin login page
  if (pathname === "/admin") {
    if (session?.role === "admin") return redirect("/admin/dashboard");
    return NextResponse.next();
  }

  // Admin dashboard requires an admin session
  if (pathname.startsWith("/admin/")) {
    if (!session) return redirect("/admin");
    if (session.role !== "admin") return redirect("/admin");
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/signup", "/admin", "/admin/:path*"],
};
