export type OrganizationAiAnswerMap = Record<string, string>;

export type OrganizationProfileData = {
  organizationName: string;
  contactPerson: string;
  email: string;
  location: string;
  organizationType: string;
  focusAreas: string[];
  description: string;
  avatarUrl: string | null;
  tagline: string;
  preferredVolunteerTraits: string[];
  commonTaskTypes: string[];
  organizationContextSummary: string;
  aiQuestionnaireAnswers: OrganizationAiAnswerMap;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type OrganizationProfileUpdate = Partial<
  Pick<
    OrganizationProfileData,
    | 'organizationName'
    | 'contactPerson'
    | 'email'
    | 'location'
    | 'organizationType'
    | 'focusAreas'
    | 'description'
    | 'avatarUrl'
    | 'tagline'
    | 'preferredVolunteerTraits'
    | 'commonTaskTypes'
    | 'organizationContextSummary'
    | 'aiQuestionnaireAnswers'
  >
>;

export type OrganizationStats = {
  events: number;
  active: number;
  applications: number;
  completed: number;
};

export type OrganizationEventStatus = 'active' | 'completed';

export type OrganizationEventPreviewItem = {
  id: string;
  title: string;
  date: string;
  imageUrl: string;
  status: OrganizationEventStatus;
  applicationsCount: number;
};

export type OrganizationDashboardData = {
  stats: OrganizationStats;
  latestEvents: OrganizationEventPreviewItem[];
};
