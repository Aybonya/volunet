export type UserRole = 'volunteer' | 'organization';

export type VolunteerSignupInput = {
  role: 'volunteer';
  fullName: string;
  email: string;
  password: string;
  city: string;
  bio: string;
  skills: string[];
  interests: string[];
  causes: string[];
  availability: string[];
};

export type OrganizationSignupInput = {
  role: 'organization';
  organizationName: string;
  contactPerson: string;
  email: string;
  password: string;
  location: string;
  organizationType: string;
  focusAreas: string[];
  description: string;
};

export type UserDocument = {
  email: string;
  role: UserRole;
  createdAt: unknown;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  updatedAt?: unknown;
};

export type VolunteerProfileDocument = {
  fullName: string;
  handle?: string;
  city: string;
  bio: string;
  aiAbout?: string;
  avatarUrl?: string | null;
  skills: string[];
  interests: string[];
  causes: string[];
  availability: string[];
  embedding: number[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type OrganizationProfileDocument = {
  organizationName: string;
  contactPerson: string;
  location: string;
  organizationType: string;
  focusAreas: string[];
  description: string;
};
