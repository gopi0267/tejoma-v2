import type { DictionaryEntry } from '../matcher/trie.js';
import type { SkillCategory } from '../types.js';

// Builds one DictionaryEntry. `aliases` defaults to just the canonical spelling; pass extra
// known synonyms/abbreviations explicitly (e.g. entry('Node.js', 'backend_framework', ['NodeJS',
// 'Node JS', 'Node'])). The canonical spelling is always included even if you also pass aliases.
function entry(canonical: string, category: SkillCategory, extraAliases: string[] = []): DictionaryEntry {
  return { canonical, category, aliases: [canonical, ...extraAliases] };
}

// Explicit synonym/alias mappings for terms recruiters commonly write differently from the
// canonical spelling - this is the "normalize every skill" requirement (Java = Core Java,
// NodeJS = Node.js, JS = JavaScript, ReactJS = React, MS SQL = SQL Server, Spring = Spring
// Framework, K8s = Kubernetes, and more of the same pattern).
const PROGRAMMING_LANGUAGES: DictionaryEntry[] = [
  entry('Python', 'programming_language'),
  entry('JavaScript', 'programming_language', ['JS', 'ECMAScript', 'ES6', 'ES2015']),
  entry('TypeScript', 'programming_language', ['TS']),
  entry('Java', 'programming_language', ['Core Java', 'J2SE', 'JDK']),
  entry('C++', 'programming_language', ['CPP']),
  entry('C#', 'programming_language', ['C-Sharp', 'CSharp']),
  entry('PHP', 'programming_language'),
  entry('Ruby', 'programming_language'),
  entry('Go', 'programming_language', ['Golang']),
  entry('Rust', 'programming_language'),
  entry('Kotlin', 'programming_language'),
  entry('Swift', 'programming_language'),
  entry('Scala', 'programming_language'),
  entry('Perl', 'programming_language'),
  entry('MATLAB', 'programming_language'),
  entry('Objective-C', 'programming_language', ['Obj-C', 'ObjC']),
  entry('VB.NET', 'programming_language'),
  entry('Groovy', 'programming_language'),
  entry('Clojure', 'programming_language'),
];

const FRONTEND: DictionaryEntry[] = [
  entry('React', 'frontend_framework', ['ReactJS', 'React.js']),
  entry('Angular', 'frontend_framework', ['AngularJS', 'Angular JS']),
  entry('Vue.js', 'frontend_framework', ['VueJS', 'Vue']),
  entry('Next.js', 'frontend_framework', ['NextJS']),
  entry('Svelte', 'frontend_framework'),
  entry('Ember.js', 'frontend_framework', ['EmberJS']),
  entry('Backbone.js', 'frontend_framework', ['BackboneJS']),
  entry('Gatsby', 'frontend_framework'),
  entry('Nuxt.js', 'frontend_framework', ['NuxtJS']),
  entry('HTML5', 'frontend_framework', ['HTML']),
  entry('CSS3', 'frontend_framework', ['CSS']),
  entry('Sass', 'frontend_framework'),
  entry('Tailwind CSS', 'frontend_framework', ['TailwindCSS', 'Tailwind']),
  entry('Bootstrap', 'frontend_framework'),
  entry('Material-UI', 'frontend_framework', ['MUI']),
  entry('React Native', 'frontend_framework', ['ReactNative']),
  entry('Flutter', 'frontend_framework'),
];

const BACKEND: DictionaryEntry[] = [
  entry('Node.js', 'backend_framework', ['NodeJS', 'Node JS', 'Node']),
  entry('Express.js', 'backend_framework', ['ExpressJS', 'Express']),
  entry('Fastify', 'backend_framework'),
  entry('NestJS', 'backend_framework', ['Nest.js']),
  entry('Django', 'backend_framework'),
  entry('Flask', 'backend_framework'),
  entry('FastAPI', 'backend_framework'),
  entry('Spring', 'backend_framework', ['Spring Framework']),
  entry('Spring Boot', 'backend_framework', ['SpringBoot']),
  entry('Spring Cloud', 'backend_framework'),
  entry('Hibernate', 'backend_framework'),
  entry('ASP.NET', 'backend_framework', ['ASP .NET']),
  entry('ASP.NET Core', 'backend_framework'),
  entry('Entity Framework', 'backend_framework'),
  entry('Laravel', 'backend_framework'),
  entry('Symfony', 'backend_framework'),
];

const DATABASES: DictionaryEntry[] = [
  entry('SQL', 'database'),
  entry('MySQL', 'database'),
  entry('PostgreSQL', 'database', ['Postgres', 'PSQL']),
  entry('Oracle', 'database'),
  entry('SQL Server', 'database', ['MS SQL', 'MSSQL', 'Microsoft SQL Server']),
  entry('MariaDB', 'database'),
  entry('SQLite', 'database'),
  entry('MongoDB', 'database', ['Mongo']),
  entry('Firebase', 'database'),
  entry('DynamoDB', 'database'),
  entry('Cassandra', 'database'),
  entry('Neo4j', 'database'),
  entry('Redis', 'database'),
  entry('Elasticsearch', 'database', ['Elastic Search', 'ES']),
];

const CLOUD: DictionaryEntry[] = [
  entry('AWS', 'cloud', ['Amazon Web Services']),
  entry('AWS EC2', 'cloud', ['EC2']),
  entry('AWS S3', 'cloud', ['S3']),
  entry('AWS Lambda', 'cloud', ['Lambda']),
  entry('AWS RDS', 'cloud', ['RDS']),
  entry('Azure', 'cloud', ['Microsoft Azure']),
  entry('Azure DevOps', 'cloud'),
  entry('Azure Functions', 'cloud'),
  entry('Google Cloud', 'cloud', ['GCP', 'Google Cloud Platform']),
];

const DEVOPS: DictionaryEntry[] = [
  entry('Docker', 'devops'),
  entry('Kubernetes', 'devops', ['K8s']),
  entry('Docker Compose', 'devops'),
  entry('Helm', 'devops'),
  entry('Terraform', 'devops'),
  entry('CloudFormation', 'devops'),
  entry('Ansible', 'devops'),
  entry('Chef', 'devops'),
  entry('Puppet', 'devops'),
  entry('Jenkins', 'devops'),
  entry('GitLab CI', 'devops'),
  entry('GitHub Actions', 'devops', ['GH Actions']),
  entry('CircleCI', 'devops'),
  entry('Travis CI', 'devops'),
];

const MESSAGING: DictionaryEntry[] = [
  entry('Apache Kafka', 'messaging', ['Kafka']),
  entry('RabbitMQ', 'messaging'),
  entry('ActiveMQ', 'messaging'),
  entry('ZeroMQ', 'messaging'),
];

const TESTING: DictionaryEntry[] = [
  entry('Selenium', 'testing', ['Selenium WebDriver']),
  entry('Cypress', 'testing'),
  entry('Playwright', 'testing'),
  entry('Jest', 'testing'),
  entry('Mocha', 'testing'),
  entry('Pytest', 'testing'),
  entry('TestNG', 'testing'),
  entry('JUnit', 'testing'),
];

const OPERATING_SYSTEMS: DictionaryEntry[] = [
  entry('Linux', 'operating_system'),
  entry('Ubuntu', 'operating_system'),
  entry('CentOS', 'operating_system'),
  entry('Red Hat', 'operating_system', ['RHEL']),
  entry('Windows Server', 'operating_system'),
  entry('macOS', 'operating_system'),
  entry('Unix', 'operating_system'),
  entry('Bash', 'operating_system'),
  entry('Shell Scripting', 'operating_system'),
  entry('PowerShell', 'operating_system'),
];

const AI_ML: DictionaryEntry[] = [
  entry('TensorFlow', 'ai_ml'),
  entry('PyTorch', 'ai_ml'),
  entry('Keras', 'ai_ml'),
  entry('Scikit-learn', 'ai_ml', ['sklearn']),
  entry('XGBoost', 'ai_ml'),
  entry('OpenCV', 'ai_ml'),
  entry('NLTK', 'ai_ml'),
  entry('spaCy', 'ai_ml'),
  entry('Machine Learning', 'ai_ml', ['ML']),
  entry('Deep Learning', 'ai_ml', ['DL']),
  entry('Neural Networks', 'ai_ml'),
  entry('Natural Language Processing', 'ai_ml', ['NLP']),
  entry('Computer Vision', 'ai_ml', ['CV']),
  entry('Large Language Models', 'ai_ml', ['LLM', 'LLMs']),
];

const DATA_ENGINEERING: DictionaryEntry[] = [
  entry('Data Science', 'data_engineering'),
  entry('Data Analysis', 'data_engineering'),
  entry('Data Visualization', 'data_engineering'),
  entry('Pandas', 'data_engineering'),
  entry('NumPy', 'data_engineering'),
  entry('Apache Spark', 'data_engineering', ['Spark', 'PySpark']),
  entry('Apache Airflow', 'data_engineering', ['Airflow']),
  entry('ETL', 'data_engineering'),
  entry('Data Warehousing', 'data_engineering'),
  entry('Snowflake', 'data_engineering'),
  entry('Power BI', 'data_engineering', ['PowerBI']),
  entry('Tableau', 'data_engineering'),
];

const TOOLS: DictionaryEntry[] = [
  entry('Git', 'tool'),
  entry('GitHub', 'tool'),
  entry('GitLab', 'tool'),
  entry('Bitbucket', 'tool'),
  entry('JIRA', 'tool'),
  entry('Confluence', 'tool'),
  entry('Postman', 'tool'),
  entry('Swagger', 'tool', ['OpenAPI']),
  entry('Figma', 'tool'),
  entry('Grafana', 'tool'),
  entry('Kibana', 'tool'),
];

const METHODOLOGIES: DictionaryEntry[] = [
  entry('Agile', 'methodology'),
  entry('Scrum', 'methodology'),
  entry('Kanban', 'methodology'),
  entry('Lean', 'methodology'),
  entry('SAFe', 'methodology'),
  entry('Waterfall', 'methodology'),
  entry('DevOps', 'methodology'),
  entry('TDD', 'methodology', ['Test-Driven Development']),
  entry('CI/CD', 'methodology', ['Continuous Integration', 'Continuous Deployment']),
];

const ARCHITECTURE: DictionaryEntry[] = [
  entry('REST API', 'architecture', ['REST', 'RESTful', 'RESTful API']),
  entry('GraphQL', 'architecture'),
  entry('gRPC', 'architecture'),
  entry('SOAP', 'architecture'),
  entry('WebSocket', 'architecture'),
  entry('Microservices', 'architecture'),
  entry('Serverless', 'architecture'),
  entry('API Gateway', 'architecture'),
  entry('Event-Driven Architecture', 'architecture'),
  entry('MERN Stack', 'architecture', ['MERN']),
  entry('MEAN Stack', 'architecture', ['MEAN']),
];

const SECURITY: DictionaryEntry[] = [
  entry('OAuth', 'security'),
  entry('OAuth2', 'security', ['OAuth 2.0']),
  entry('JWT', 'security', ['JSON Web Token']),
  entry('SSL', 'security'),
  entry('TLS', 'security'),
];

export const SKILL_DICTIONARY: DictionaryEntry[] = [
  ...PROGRAMMING_LANGUAGES,
  ...FRONTEND,
  ...BACKEND,
  ...DATABASES,
  ...CLOUD,
  ...DEVOPS,
  ...MESSAGING,
  ...TESTING,
  ...OPERATING_SYSTEMS,
  ...AI_ML,
  ...DATA_ENGINEERING,
  ...TOOLS,
  ...METHODOLOGIES,
  ...ARCHITECTURE,
  ...SECURITY,
];

// Category groups exposed separately so the dictionary tier can route matches from the SAME
// scan into requiredTools / requiredTechnologies / requiredFrameworks / requiredDatabases /
// requiredCloudPlatforms / requiredMethodologies without re-scanning the text per category.
export const CATEGORY_TO_OUTPUT_FIELD: Record<SkillCategory, 'requiredFrameworks' | 'requiredDatabases' | 'requiredCloudPlatforms' | 'requiredMethodologies' | 'requiredTools' | 'requiredTechnologies' | null> = {
  programming_language: 'requiredTechnologies',
  frontend_framework: 'requiredFrameworks',
  backend_framework: 'requiredFrameworks',
  database: 'requiredDatabases',
  cloud: 'requiredCloudPlatforms',
  devops: 'requiredTools',
  testing: 'requiredTools',
  messaging: 'requiredTechnologies',
  operating_system: 'requiredTechnologies',
  ai_ml: 'requiredTechnologies',
  data_engineering: 'requiredTechnologies',
  tool: 'requiredTools',
  library: 'requiredTechnologies',
  methodology: 'requiredMethodologies',
  architecture: 'requiredTechnologies',
  security: 'requiredTechnologies',
  design: 'requiredTools',
  soft_skill: null,
  general: null,
};
