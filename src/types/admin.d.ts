export type User = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  emailVerified: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SystemStats = {
  users: number;
};

export type AdminLoaderData =
  | { status: 'success'; users: User[]; stats: SystemStats }
  | { status: 'partial'; users?: User[]; stats?: SystemStats; errors: string[] }
  | { status: 'error'; errors: string[] };
