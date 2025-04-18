import { NextFunction, Request, Response } from "express";

export const requireApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
): Response<any, Record<string, any>> | void => {
  const apiKey = req.headers["authorization"];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
};
