import type { NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/session'

export function proxy(request: NextRequest) {
  return updateSession(request)
}

export default proxy

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
