const USERS_KEY = "jobdrips_demo_users";

interface DemoUser {
  email: string;
  passwordHash: string;
}

const normalizeEmail = (email: string) => {
  return email.trim().toLowerCase();
};

const readUsers = (): DemoUser[] => {
  try {
    const raw = localStorage.getItem(USERS_KEY);

    return raw
      ? (JSON.parse(raw) as DemoUser[])
      : [];
  } catch {
    return [];
  }
};

const writeUsers = (users: DemoUser[]) => {
  localStorage.setItem(
    USERS_KEY,
    JSON.stringify(users)
  );
};

const hashPassword = async (
  password: string
) => {
  const data = new TextEncoder().encode(password);

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return Array.from(
    new Uint8Array(hashBuffer)
  )
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
};

export const userExists = (
  email: string
) => {
  const normalizedEmail =
    normalizeEmail(email);

  return readUsers().some(
    (user) =>
      user.email === normalizedEmail
  );
};

export const createDemoUser = async (
  email: string,
  password: string
) => {
  const normalizedEmail =
    normalizeEmail(email);

  const users = readUsers();

  if (
    users.some(
      (user) =>
        user.email === normalizedEmail
    )
  ) {
    return false;
  }

  const passwordHash =
    await hashPassword(password);

  users.push({
    email: normalizedEmail,
    passwordHash,
  });

  writeUsers(users);

  return true;
};

export const verifyDemoPassword = async (
  email: string,
  password: string
) => {
  const normalizedEmail =
    normalizeEmail(email);

  const user = readUsers().find(
    (item) =>
      item.email === normalizedEmail
  );

  if (!user) {
    return {
      exists: false,
      passwordMatched: false,
    };
  }

  const passwordHash =
    await hashPassword(password);

  return {
    exists: true,
    passwordMatched:
      passwordHash ===
      user.passwordHash,
  };
};

export const updateDemoPassword =
  async (
    email: string,
    password: string
  ) => {
    const normalizedEmail =
      normalizeEmail(email);

    const users = readUsers();

    const index = users.findIndex(
      (user) =>
        user.email === normalizedEmail
    );

    if (index === -1) {
      return false;
    }

    users[index].passwordHash =
      await hashPassword(password);

    writeUsers(users);

    return true;
  };