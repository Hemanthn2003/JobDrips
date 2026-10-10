interface PagePlaceholderProps {
  title: string;
  description: string;
  icon: string;
}

const PagePlaceholder = ({
  title,
  description,
  icon,
}: PagePlaceholderProps) => {
  return (
    <section className="mx-auto flex w-full max-w-[1100px] justify-center">
      <div className="w-full rounded-[22px] border border-[var(--jd-border)] bg-[var(--jd-surface)] p-6 shadow-[var(--jd-shadow)] sm:p-8 md:p-10 lg:p-12">
        <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
          <div className="mb-6 flex h-[78px] w-[78px] items-center justify-center rounded-[22px] bg-[var(--jd-card)]">
            <img
              src={icon}
              alt=""
              className="h-[42px] w-[42px]"
            />
          </div>

          <h1 className="text-[25px] font-extrabold tracking-[-0.02em] text-[var(--jd-primary-text)] sm:text-[30px] md:text-[36px]">
            {title}
          </h1>

          <p className="mt-3 max-w-[580px] text-[13px] leading-6 text-[var(--jd-secondary-text)] sm:text-[14px] md:text-[15px]">
            {description}
          </p>

          <div className="mt-7 rounded-full border border-[var(--jd-border)] bg-[var(--jd-card)] px-5 py-2.5 text-[11px] font-bold text-[var(--jd-dark-rose-gold)] sm:text-[12px]">
            Page ready — development coming next
          </div>
        </div>
      </div>
    </section>
  );
};

export default PagePlaceholder;