-- Rehearsal-only seed data - simulates existing production candidate_accounts/candidate_experiences
-- rows for the Batch 2.5 cutover-mechanism rehearsal. Not part of the application; lives only in
-- scripts/lib/ as a one-off tool, never referenced by src/.

INSERT INTO candidate_accounts
  (name, email, phone, password_hash, is_active, headline, skills, years_of_experience, location,
   education, summary, current_company, certifications, tools, languages, notice_period,
   current_ctc, expected_ctc, open_to_work, visible_to_recruiters, onboarding_completed_at)
VALUES
  ('Ananya Rao', 'ananya.rao@example.test', NULL, 'hashed', true, 'Senior Backend Engineer',
   ARRAY['Node.js','PostgreSQL','Kubernetes'], '6 years', 'Bangalore', 'B.Tech Computer Science',
   'Backend engineer focused on distributed systems.', 'Flipkart', ARRAY['AWS Certified SA'],
   ARRAY['Docker','Terraform'], ARRAY['English','Hindi','Kannada'], '30 days', '22 LPA', '30 LPA',
   true, true, NOW()),
  ('Rohan Mehta', 'rohan.mehta@example.test', NULL, 'hashed', true, 'Frontend Developer',
   ARRAY['React','TypeScript','CSS'], '3 years', 'Pune', 'BCA', 'Frontend developer building design systems.',
   'Zeta', ARRAY[]::text[], ARRAY['Figma','Vite'], ARRAY['English','Marathi'], '15 days', '12 LPA', '18 LPA',
   true, true, NOW()),
  ('Priya Nair', 'priya.nair@example.test', NULL, 'hashed', true, 'Data Scientist',
   ARRAY['Python','SQL','Machine Learning'], '4 years', 'Chennai', 'M.Sc Statistics',
   'Data scientist working on churn models.', 'Swiggy', ARRAY['TensorFlow Developer Certificate'],
   ARRAY['Jupyter','Spark'], ARRAY['English','Tamil'], 'Immediate', '18 LPA', '25 LPA', true, true, NOW()),
  ('Karan Singh', 'karan.singh@example.test', NULL, 'hashed', true, NULL, ARRAY['Java','Spring Boot'],
   '2 years', 'Delhi', NULL, NULL, 'TCS', ARRAY[]::text[], ARRAY[]::text[], ARRAY['English','Hindi'],
   '60 days', '8 LPA', '12 LPA', true, true, NULL),
  ('Fatima Sheikh', 'fatima.sheikh@example.test', NULL, 'hashed', true, 'DevOps Engineer',
   ARRAY['AWS','Terraform','Kubernetes','CI/CD'], '5 years', 'Hyderabad', 'B.E Information Technology',
   'DevOps engineer specializing in EKS platform work.', 'Freshworks', ARRAY['CKA'], ARRAY['ArgoCD','Helm'],
   ARRAY['English','Urdu'], '30 days', '20 LPA', '28 LPA', false, true, NOW()),
  ('Vikram Desai', 'vikram.desai@example.test', NULL, 'hashed', true, 'QA Automation Engineer',
   ARRAY['Selenium','Java','Cypress'], '3 years', 'Mumbai', 'B.Tech Electronics',
   'QA engineer building end-to-end automation suites.', 'Paytm', ARRAY[]::text[], ARRAY['Jenkins'],
   ARRAY['English','Hindi','Gujarati'], '30 days', '11 LPA', '16 LPA', true, true, NOW())
RETURNING id;
