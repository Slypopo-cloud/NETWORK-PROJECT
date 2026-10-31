import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from './app.js';

describe('GET /v1/health', () => {
  it('returns the healthy status envelope', async () => {
    const response = await request(app).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'ok',
      },
    });
  });
});