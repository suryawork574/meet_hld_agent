import { logger } from '../utils/logger.js';

const DESIGN_KEYWORDS = [
  'architecture', 'microservice', 'microservices', 'service',
  'database', 'api', 'endpoint', 'load balancer', 'gateway',
  'cache', 'redis', 'kafka', 'queue', 'message broker',
  'kubernetes', 'k8s', 'docker', 'container', 'deployment',
  'schema', 'table', 'collection', 'nosql', 'sql', 'mysql', 'postgres', 'mongodb',
  'rest', 'graphql', 'grpc', 'websocket',
  'cdn', 'proxy', 'nginx', 'reverse proxy',
  'authentication', 'auth', 'oauth', 'jwt',
  'scalability', 'horizontal scaling', 'vertical scaling',
  'replication', 'sharding', 'partitioning',
  'pub sub', 'pubsub', 'event driven', 'event-driven',
  'data flow', 'data pipeline', 'etl', 'cdc', 'change data capture',
  'system design', 'high level design', 'low level design',
  'component', 'module', 'layer', 'tier',
  'frontend', 'backend', 'middleware',
  'server', 'client', 'request', 'response',
  'latency', 'throughput', 'availability',
  'consistent hashing', 'rate limiting', 'circuit breaker',
  'storage', 's3', 'blob', 'object store',
  'notification', 'webhook', 'callback',
  'connector', 'producer', 'consumer', 'topic',
  'olap', 'oltp', 'data warehouse', 'report',
  'binlog', 'pin log', 'debezium',
  'publish', 'subscribe', 'event',
];

const KEYWORD_DENSITY_THRESHOLD = 2; // Minimum keyword matches to flag as design

export function detectDesignDiscussion(text: string): {
  isDesign: boolean;
  confidence: number;
  matchedKeywords: string[];
} {
  const lowerText = text.toLowerCase();
  const matchedKeywords: string[] = [];

  for (const keyword of DESIGN_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }

  const confidence = Math.min(matchedKeywords.length / KEYWORD_DENSITY_THRESHOLD, 1);
  const isDesign = matchedKeywords.length >= KEYWORD_DENSITY_THRESHOLD;

  if (isDesign) {
    logger.info({ matchedKeywords, confidence }, 'Design discussion detected');
  }

  return { isDesign, confidence, matchedKeywords };
}
