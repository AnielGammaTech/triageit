-- Fix infinite recursion in RLS policies
-- The "Admins can read all profiles" policy on `profiles` queries `profiles` itself → infinite loop.
-- Solution: Use a SECURITY DEFINER function that bypasses RLS to check admin status.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Drop the recursive profile policies
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;

-- Recreate profile policies without recursion
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (public.is_admin());

-- Fix integrations policy to use the function
DROP POLICY IF EXISTS "Admins can manage integrations" ON integrations;
CREATE POLICY "Admins can manage integrations"
  ON integrations FOR ALL
  USING (public.is_admin());

-- Also allow service_role to manage integrations (for worker)
CREATE POLICY "Service role can manage integrations"
  ON integrations FOR ALL
  USING (current_setting('role') = 'service_role');

-- Fix integration_mappings policies
DROP POLICY IF EXISTS "Admins can manage integration mappings" ON integration_mappings;
CREATE POLICY "Admins can manage integration mappings"
  ON integration_mappings FOR ALL
  USING (public.is_admin());

-- Fix triage_rules policy
DROP POLICY IF EXISTS "Admins can manage triage rules" ON triage_rules;
CREATE POLICY "Admins can manage triage rules"
  ON triage_rules FOR ALL
  USING (public.is_admin());

-- Fix agent_skills policy
DROP POLICY IF EXISTS "Admins can manage agent skills" ON agent_skills;
CREATE POLICY "Admins can manage agent skills"
  ON agent_skills FOR ALL
  USING (public.is_admin());

-- Fix agent_memories policy
DROP POLICY IF EXISTS "Admins can manage agent memories" ON agent_memories;
CREATE POLICY "Admins can manage agent memories"
  ON agent_memories FOR ALL
  USING (public.is_admin());
