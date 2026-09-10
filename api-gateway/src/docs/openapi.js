/** OpenAPI 3 description of the public gateway surface. */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Microservices Assignment API',
    version: '1.0.0',
    description:
      'Public API exposed by the API Gateway. The gateway routes to the User Service and Notification Service; those two services never call each other over REST — they communicate exclusively via NATS JetStream events.',
  },
  // Relative URL: Swagger UI resolves it against the host serving the docs,
  // so the same spec works on any gateway port.
  servers: [{ url: '/', description: 'This gateway' }],
  tags: [
    { name: 'auth' },
    { name: 'users' },
    { name: 'notifications' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Envelope: {
        type: 'object',
        properties: { success: { type: 'boolean' }, data: { type: 'object' } },
      },
      ErrorEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          type: { type: 'string', enum: ['WELCOME', 'PROFILE_UPDATED'] },
          message: { type: 'string' },
          status: { type: 'string', enum: ['created', 'read'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Vishwajeet' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'User registered; welcome event published to JetStream',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        user: { $ref: '#/components/schemas/User' },
                        token: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          '409': { description: 'Email already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
          '429': { description: 'Rate limited', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Log in and receive a JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'JWT issued', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
        },
      },
    },
    '/api/users/me': {
      get: {
        tags: ['users'],
        summary: 'Get the authenticated user profile',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'User profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
          '401': { description: 'Missing or invalid token' },
        },
      },
      patch: {
        tags: ['users'],
        summary: 'Update profile (publishes user.updated)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
                minProperties: 1,
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated user' },
          '400': { description: 'No updatable fields provided' },
          '409': { description: 'Email already registered' },
        },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['notifications'],
        summary: "List the authenticated user's notifications",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': {
            description: 'Paginated notifications (only the caller\u2019s own)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } },
          },
          '401': { description: 'Missing or invalid token' },
        },
      },
    },
    '/api/notifications/{id}': {
      get: {
        tags: ['notifications'],
        summary: 'Fetch one notification (ownership enforced)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'The notification' },
          '404': { description: 'Not found or not owned by caller' },
        },
      },
    },
  },
};

module.exports = spec;
