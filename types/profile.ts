export type VolunteerProfileData = {
  fullName: string;
  handle: string;
  city: string;
  bio: string;
  aiAbout: string;
  avatarUrl: string | null;
  skills: string[];
  interests: string[];
  causes: string[];
  availability: string[];
  embedding: number[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type VolunteerProfileUpdate = Partial<
  Pick<
    VolunteerProfileData,
    'fullName' | 'handle' | 'city' | 'bio' | 'aiAbout' | 'avatarUrl' | 'skills' | 'interests'
  >
>;

export type VolunteerStats = {
  eventsJoined: number;
  volunteerHours: number;
  thanksCount: number;
  completedTasks: number;
  completionRate: number | null;
  monthlyImpactCount: number;
};

export type VolunteerActivityItem = {
  id: string;
  title: string;
  subtitle: string;
};

export type VolunteerProfileInsights = {
  impactHeadline: string;
  impactBody: string;
  reliabilityLabel: string;
  activityItems: VolunteerActivityItem[];
};

export type ParticipationStatus = 'joined' | 'accepted' | 'completed' | 'cancelled' | 'removed';

export type ParticipationRecord = {
  id: string;
  userId: string;
  eventId: string;
  status: ParticipationStatus;
  hours: number;
  createdAt?: unknown;
  completedAt?: unknown;
  eventTitle?: string;
};

export type GratitudeRecord = {
  id: string;
  toUserId: string;
  fromOrganizationId?: string;
  eventId?: string;
  message?: string;
  createdAt?: unknown;
};
