import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearSessionDek } from '../lib/sessionKey'

/**
 * Framework-agnostic auth functions, shared with mobile/desktop clients later.
 */

// Password auth, not magic links/OTP: this app's own email sending is on
// Supabase's shared free-tier provider, whose rate limit a 1-2 person app
// can hit outright, and any emailed link/code also has to round-trip through
// the OS's default browser -- never back into an installed home-screen PWA.
// Password sign-in/sign-up need no email at all (enable_confirmations is off
// in supabase/config.toml), so neither problem applies.
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUpWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  clearSessionDek()
  if (error) throw error
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return () => subscription.unsubscribe()
}
