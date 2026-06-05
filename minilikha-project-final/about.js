const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const revealItems = document.querySelectorAll(".reveal");

function closeMenu() {
    document.body.classList.remove("menu-open");
    mobileMenu?.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    const icon = menuToggle?.querySelector("i");
    if (icon) {
        icon.classList.remove("fa-xmark");
        icon.classList.add("fa-bars");
    }
}

function toggleMenu() {
    const isOpen = document.body.classList.toggle("menu-open");
    mobileMenu?.classList.toggle("is-open", isOpen);
    menuToggle?.setAttribute("aria-expanded", String(isOpen));
    const icon = menuToggle?.querySelector("i");
    if (icon) {
        icon.classList.toggle("fa-bars", !isOpen);
        icon.classList.toggle("fa-xmark", isOpen);
    }
}

function updateHeaderState() {
    document.body.classList.toggle("scrolled", window.scrollY > 12);
}

menuToggle?.addEventListener("click", toggleMenu);

mobileMenu?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
        const target = document.querySelector(link.getAttribute("href"));
        if (!target) return;
        event.preventDefault();
        closeMenu();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("in-view");
            revealObserver.unobserve(entry.target);
        });
    }, { threshold: 0.18 })
    : null;

revealItems.forEach((item) => {
    if (revealObserver) revealObserver.observe(item);
    else item.classList.add("in-view");
});

document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("error", () => {
        image.style.visibility = "hidden";
        image.parentElement?.classList.add("image-fallback");
    }, { once: true });
});

window.addEventListener("scroll", updateHeaderState, { passive: true });
window.addEventListener("resize", () => {
    if (window.innerWidth >= 860) closeMenu();
});

updateHeaderState();

if (header) {
    header.style.setProperty("--header-height", `${header.offsetHeight}px`);
}
