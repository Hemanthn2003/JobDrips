import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE_URL =
  "http://localhost:5000/api/auth";

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  profilePhoto: string;
  createdAt: string;
  updatedAt: string;
}

const Profile = () => {
  const navigate = useNavigate();

  const [user, setUser] =
    useState<CurrentUser | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/me`,
          {
            method: "GET",
            credentials: "include",
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          if (
            response.status === 401
          ) {
            navigate("/", {
              replace: true,
            });

            return;
          }

          throw new Error(
            data.message ||
              "Unable to fetch profile."
          );
        }

        setUser(data.user);
      } catch (error) {
        console.error(
          "Profile:",
          error
        );

        setError(
          "Unable to load your profile."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchCurrentUser();
  }, [navigate]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--jd-warm-white)]">
        <div className="rounded-[22px] border border-[var(--jd-border)] bg-[var(--jd-surface)] px-8 py-6 text-center shadow-[var(--jd-shadow)]">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-[var(--jd-champagne)] border-t-[var(--jd-rose-gold)]" />
          <p className="font-semibold text-[var(--jd-secondary-text)]">
            Loading profile...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--jd-warm-white)] px-4">
        <div className="w-full max-w-md rounded-[24px] border border-[var(--jd-border)] bg-[var(--jd-surface)] p-8 text-center shadow-[var(--jd-shadow)]">
          <h1 className="text-xl font-extrabold text-[var(--jd-primary-text)]">
            Unable to load profile
          </h1>

          <p className="mt-2 text-sm text-[var(--jd-error)]">
            {error}
          </p>

          <button
            type="button"
            onClick={() =>
              window.location.reload()
            }
            className="mt-6 h-12 w-full rounded-full bg-gradient-to-b from-[#CF8F70] to-[#A4543A] font-bold text-white shadow-[var(--jd-button-shadow)]"
          >
            Try Again
          </button>
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[var(--jd-warm-white)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-4xl">
        <section className="overflow-hidden rounded-[28px] border border-[var(--jd-border)] bg-[var(--jd-surface)] shadow-[var(--jd-shadow-strong)]">
          <div className="h-40 bg-gradient-to-r from-[#F2D7C3] via-[#E8C1AA] to-[#D9A68A] sm:h-52" />

          <div className="relative px-5 pb-8 sm:px-8 lg:px-10">
            <div className="-mt-16 flex flex-col items-center sm:-mt-20 sm:items-start">
              <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-[24px] border-4 border-[var(--jd-surface)] bg-[var(--jd-champagne)] shadow-lg sm:h-40 sm:w-40">
                {user.profilePhoto ? (
                  <img
                    src={user.profilePhoto}
                    alt={user.name || "Profile"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-4xl font-extrabold text-[var(--jd-rose-gold)]">
                    {(user.name ||
                      user.email)
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                )}
              </div>

              <div className="mt-5 text-center sm:text-left">
                <h1 className="text-2xl font-extrabold tracking-tight text-[var(--jd-primary-text)] sm:text-3xl">
                  {user.name ||
                    "JobDrips User"}
                </h1>

                <p className="mt-1 text-sm font-semibold text-[var(--jd-secondary-text)] sm:text-base">
                  {user.email}
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[18px] border border-[var(--jd-border)] bg-[#FFF8F4] p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--jd-muted)]">
                  Email
                </p>

                <p className="mt-2 break-all text-sm font-bold text-[var(--jd-primary-text)]">
                  {user.email}
                </p>
              </div>

              <div className="rounded-[18px] border border-[var(--jd-border)] bg-[#FFF8F4] p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--jd-muted)]">
                  Member since
                </p>

                <p className="mt-2 text-sm font-bold text-[var(--jd-primary-text)]">
                  {new Date(
                    user.createdAt
                  ).toLocaleDateString(
                    "en-IN",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Profile;