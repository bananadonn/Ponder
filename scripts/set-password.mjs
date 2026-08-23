// One-off admin tool: sets/resets a user's password directly via the Admin
// API. Needed for the two accounts created under the old passwordless
// (magic-link/OTP) flow -- they have no password on file, and the new
// LoginPage only does email+password (see PLAN.md / src/pages/LoginPage.tsx
// for why: avoiding Supabase's shared-tier email rate limit and the
// "confirmation link opens outside the installed PWA" problem).
//
// Usage:
//   node --env-file=scripts/.env scripts/set-password.mjs <email> <new-password>
//   node --env-file=scripts/.env scripts/set-password.mjs --list

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See scripts/.env.example.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function listUsers() {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) {
    console.error('Failed to list users:', error.message)
    process.exit(1)
  }
  for (const u of data.users) {
    console.log(`${u.email}  (id: ${u.id}, created: ${u.created_at})`)
  }
}

async function setPassword(email, password) {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) {
    console.error('Failed to list users:', error.message)
    process.exit(1)
  }
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exit(1)
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password })
  if (updateError) {
    console.error('Failed to set password:', updateError.message)
    process.exit(1)
  }
  console.log(`Password set for ${email}.`)
}

const [, , arg1, arg2] = process.argv

if (arg1 === '--list') {
  await listUsers()
} else if (arg1 && arg2) {
  await setPassword(arg1, arg2)
} else {
  console.error('Usage: node --env-file=scripts/.env scripts/set-password.mjs <email> <new-password>')
  console.error('   or: node --env-file=scripts/.env scripts/set-password.mjs --list')
  process.exit(1)
}
