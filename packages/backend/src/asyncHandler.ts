import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async Express handler so rejections are passed to `next(err)` (central error middleware).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
