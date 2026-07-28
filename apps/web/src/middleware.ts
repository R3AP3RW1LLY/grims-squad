import { NextResponse, type NextRequest } from 'next/server';

/**
 * Publishes the current path as a request header.
 *
 * ★ WHY THIS IS NEEDED AT ALL ★
 *
 * A server layout has no `usePathname` — that is a client hook — and Next does
 * not pass the path to layouts in any supported way. The hub sidebar needs it
 * to know which entry to mark as the current page.
 *
 * The alternatives are worse. Making the whole shell a client component would
 * ship the navigation model to the browser and lose the server-rendered first
 * paint. Threading the path down from every page would mean every new page
 * having to remember, and the one that forgets gets a sidebar with nothing
 * highlighted.
 *
 * A header set in middleware is read by the layout and by nothing else.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  /*
   * Everything except static assets and the API proxy.
   *
   * Running on `/_next/static` would put a middleware invocation in front of
   * every stylesheet and font for a header that nothing serving them reads.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|v1/).*)'],
};
