const header = document.querySelector("#site-header");
const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector("#site-nav");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const heroMedia = document.querySelector(".hero-media");

const closeMenu = () => {
  menuButton?.setAttribute("aria-expanded", "false");
  nav?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
};

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  nav.classList.toggle("is-open", !open);
  document.body.classList.toggle("menu-open", !open);
});

navLinks.forEach((link) => link.addEventListener("click", closeMenu));

const updateHeader = () => {
  header?.classList.toggle("is-sticky", window.scrollY > 34);
};

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in-view");
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.13 }
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

const sections = [...document.querySelectorAll("#collection, #about, #store")];
const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-45% 0px -50%", threshold: 0 }
);

sections.forEach((section) => sectionObserver.observe(section));

const canParallax = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
if (canParallax) {
  document.querySelector(".hero")?.addEventListener("pointermove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * -10;
    const y = (event.clientY / window.innerHeight - 0.5) * -6;
    heroMedia.style.transform = `scale(1.035) translate(${x}px, ${y}px)`;
  });
}

document.querySelector("#year").textContent = new Date().getFullYear();
