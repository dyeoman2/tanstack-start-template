// Define user interface explicitly - matches Convex query return type
export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  emailVerified: boolean;
  createdAt: number; // Unix timestamp from Convex
  updatedAt: number; // Unix timestamp from Convex
}
