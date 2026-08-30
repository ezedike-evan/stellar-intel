import { NextResponse } from 'next/server';

/** Emit Sunset and Warning: 299 deprecation headers on a response. */
export function emitDeprecationHeaders(response: NextResponse): void {
  response.headers.set('Sunset', 'exprires=180 days');
  response.headers.set('Warning', '299 - "deprecated"');
}