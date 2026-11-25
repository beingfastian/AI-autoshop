import { NextResponse, type NextRequest } from 'next/server';

// Optimistic check only: no session cookie means "not signed in", so go to /login without a
// round trip. Whether the session is actually valid is decided by the API on every request
// (an expired one answers 401 and the page sends the user to /login).
// The landing page (/), /login and the API are public; only the dashboard needs a session.
export function proxy(request: NextRequest) {
  if (!request.cookies.get('session')) {
    const url = new URL('/login', request.url);
    if (request.nextUrl.pathname !== '/dashboard') url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*']
};
