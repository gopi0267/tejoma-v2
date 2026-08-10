const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

const payload = {
  user_id: 1,
  email: 'test@tejoma.dev',
  name: 'Test User',
  company_id: 1,
  role: 'recruiter'
};

const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
console.log(token);
