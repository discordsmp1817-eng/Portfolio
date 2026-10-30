document.addEventListener('DOMContentLoaded', () => {

  // 0. ENTRY ANIMATION
  //    Logo appears centered -> travels to the navbar logo -> overlay wipes away to reveal the site
  (function runEntryAnimation() {
    const root = document.documentElement;
    if (!root.classList.contains('intro-active')) return; // skipped (e.g. reduced motion)

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    const overlay = document.getElementById('introOverlay');
    const navLogo = document.querySelector('.header .logo');
    let flyLogo = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      root.classList.remove('intro-active', 'intro-wipe');
      if (flyLogo) flyLogo.remove();
      if (overlay) overlay.remove();
    };

    if (!overlay || !navLogo || !navLogo.animate) { finish(); return; }

    // Wait for the web font so measurements are accurate (but never wait more than 2s)
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    const timeout = new Promise(resolve => setTimeout(resolve, 2000));

    Promise.race([fontsReady, timeout]).then(() => {
      // Build the flying logo as a clone of the navbar logo
      flyLogo = document.createElement('div');
      flyLogo.className = 'intro-logo';
      flyLogo.setAttribute('aria-hidden', 'true');
      flyLogo.innerHTML = navLogo.innerHTML;
      // The logo mark is sized in em, so this font-size sets the splash size (mark = 1.9 x font-size)
      flyLogo.style.fontSize = Math.round(Math.min(Math.max(Math.min(window.innerWidth, window.innerHeight) * 0.14, 48), 84)) + 'px';
      document.body.appendChild(flyLogo);

      // Long names: shrink the big logo so it always fits on screen
      const maxW = window.innerWidth * 0.84;
      const naturalW = flyLogo.getBoundingClientRect().width;
      if (naturalW > maxW) {
        flyLogo.style.fontSize = (parseFloat(flyLogo.style.fontSize) * maxW / naturalW).toFixed(1) + 'px';
      }

      // Measure
      const fly = flyLogo.getBoundingClientRect();           // natural size, top-left at (0,0)
      const target = navLogo.getBoundingClientRect();        // real navbar logo position
      const startX = window.innerWidth / 2 - fly.width / 2;
      const startY = window.innerHeight / 2 - fly.height / 2;
      const endX = target.left + target.width / 2 - fly.width / 2;
      const endY = target.top + target.height / 2 - fly.height / 2;
      const endScale = target.width / fly.width;

      const centered = `translate(${startX}px, ${startY}px) scale(1)`;
      const docked = `translate(${endX}px, ${endY}px) scale(${endScale})`;

      // Step 1: logo appears in the center
      const appear = flyLogo.animate([
        { opacity: 0, transform: `translate(${startX}px, ${startY + 24}px) scale(0.92)` },
        { opacity: 1, transform: centered }
      ], { duration: 800, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' });

      appear.onfinish = () => {
        // Step 2: hold a beat, then travel to the navbar logo position
        setTimeout(() => {
          const travel = flyLogo.animate([
            { transform: centered },
            { transform: docked }
          ], { duration: 1100, easing: 'cubic-bezier(0.76, 0, 0.24, 1)', fill: 'forwards' });

          travel.onfinish = () => {
            // Step 3: reveal the website (overlay wipes up, hero animations + nav links start)
            root.classList.add('intro-wipe');
            let wiped = false;
            const wipeDone = () => { if (!wiped) { wiped = true; finish(); } };
            overlay.addEventListener('transitionend', wipeDone, { once: true });
            setTimeout(wipeDone, 1200); // fallback
          };
        }, 450);
      };
    });
  })();

  // 0b. HYPERSPEED BACKGROUND (fixed behind the whole page)
  const hyperHost = document.getElementById('hyperspeed');
  if (hyperHost && window.Hyperspeed) {
    new window.Hyperspeed(hyperHost, {
      curve: 'winding',
      curvature: 1,
      speed: 1,
      boost: 3,
      fov: 90,
      boostFov: 130,
      lanes: 3,
      roadWidth: 10,
      medianWidth: 2,
      density: 40,
      trailLength: 1,
      lightSize: 1,
      poles: 20,
      dust: 100,
      glow: 0.6,
      reflections: 0.5,
      roadOpacity: 0.1,
      steer: 0.35,
      tailColors: ['#d856bf', '#6750a2', '#c247ac'],
      headColors: ['#03b3c3', '#0e5ea5', '#324555'],
      poleColors: ['#03b3c3'],
      interactive: true, // click / tap (or hold) anywhere to boost
      reducedMotion: 'ignore' // laptops with "reduce motion" on were getting a slowed, non-interactive background
    });
  } else if (hyperHost) {
    hyperHost.dataset.status = 'script-missing';
    console.warn('[Hyperspeed] hyperspeed.js did not load. Check that it sits next to index.html.');
  }

  // 1. CUSTOM CURSOR
  const cursorDot = document.getElementById('cursorDot');
  const cursorRing = document.getElementById('cursorRing');

  if (cursorDot && cursorRing) {
    let mouseX = -100;
    let mouseY = -100;
    let ringX = -100;
    let ringY = -100;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      cursorDot.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
    });

    // Smooth lerp follow for outer ring
    function renderCursor() {
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      cursorRing.style.transform = `translate(${ringX}px, ${ringY}px)`;
      requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);

    // Hover effect on links and buttons
    const interactive = document.querySelectorAll('a, button, .project-card, .creative-service-card');
    interactive.forEach(el => {
      el.addEventListener('mouseenter', () => {
        cursorRing.style.width = '54px';
        cursorRing.style.height = '54px';
        cursorRing.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      });
      el.addEventListener('mouseleave', () => {
        cursorRing.style.width = '36px';
        cursorRing.style.height = '36px';
        cursorRing.style.backgroundColor = 'transparent';
      });
    });
  }

  // 2. NAVBAR: compact on scroll, hides when scrolling down / returns when scrolling up,
  //    scroll-progress line, and a sliding highlight that follows hover + the section in view
  const navbar = document.getElementById('navbar');
  const navProgress = document.getElementById('navProgress');
  const desktopNav = document.querySelector('.desktop-nav');
  const navIndicator = document.getElementById('navIndicator');
  const navLinks = document.querySelectorAll('.desktop-nav .nav-link');
  const navContent = navbar ? navbar.querySelector('.nav-content') : null;
  const spyIds = ['services', 'work', 'about', 'contact']; // must match the order on the page
  let activeLink = null;
  let hoverLink = null;
  let lastY = window.scrollY;
  let navLockUntil = 0;
  let navTicking = false;

  function moveIndicator(link, instant) {
    if (!navIndicator || !desktopNav) return;
    if (!link) { navIndicator.style.opacity = '0'; return; }
    const nr = desktopNav.getBoundingClientRect();
    const r = link.getBoundingClientRect();
    if (instant || navIndicator.style.opacity !== '1') {
      navIndicator.style.transition = 'none';
    }
    navIndicator.style.width = r.width + 'px';
    navIndicator.style.transform = `translateX(${r.left - nr.left - desktopNav.clientLeft}px)`;
    navIndicator.style.opacity = '1';
    if (instant || navIndicator.style.transition === 'none') {
      void navIndicator.offsetWidth; // flush, then restore the CSS transition
      navIndicator.style.transition = '';
    }
  }

  function updateNav() {
    if (!navbar) return;
    const y = window.scrollY;
    navbar.classList.toggle('scrolled', y > 40);

    // Hide on scroll down, show on scroll up (never while the mobile menu is open)
    const menuOpen = document.getElementById('mobileMenu')?.classList.contains('open');
    const delta = y - lastY;
    if (Math.abs(delta) > 6) {
      if (menuOpen || y <= 160 || delta < 0 || Date.now() < navLockUntil) {
        navbar.classList.remove('nav-hidden');
      } else {
        navbar.classList.add('nav-hidden');
      }
      lastY = y;
    }

    // Scroll progress line
    if (navProgress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      navProgress.style.setProperty('--p', (max > 0 ? Math.min(y / max, 1) : 0).toFixed(4));
    }

    // Scroll-spy: highlight the link for the section in view
    const mid = window.innerHeight * 0.4;
    let current = null;
    spyIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= mid) current = id;
    });
    const link = current ? document.querySelector(`.desktop-nav .nav-link[data-section="${current}"]`) : null;
    if (link !== activeLink) {
      if (activeLink) activeLink.classList.remove('active');
      if (link) link.classList.add('active');
      activeLink = link;
      if (!hoverLink) moveIndicator(activeLink);
    }
  }

  window.addEventListener('scroll', () => {
    if (navTicking) return;
    navTicking = true;
    requestAnimationFrame(() => { updateNav(); navTicking = false; });
  }, { passive: true });

  navLinks.forEach(link => {
    link.addEventListener('mouseenter', () => { hoverLink = link; moveIndicator(link); });
    link.addEventListener('focus', () => { hoverLink = link; moveIndicator(link); });
    link.addEventListener('click', () => { navLockUntil = Date.now() + 1400; }); // keep the bar visible during smooth scroll
  });
  if (desktopNav) {
    desktopNav.addEventListener('mouseleave', () => { hoverLink = null; moveIndicator(activeLink); });
  }
  // The pill resizes when it shrinks: realign the highlight once that finishes
  if (navContent) {
    navContent.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'max-width') moveIndicator(hoverLink || activeLink, true);
    });
  }
  window.addEventListener('resize', () => moveIndicator(hoverLink || activeLink, true));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => moveIndicator(hoverLink || activeLink, true));
  }
  updateNav();

  // Magnetic "Hire Me" button
  const navBtn = document.querySelector('.nav-btn');
  if (navBtn && window.matchMedia('(pointer: fine)').matches) {
    navBtn.addEventListener('mousemove', (e) => {
      const r = navBtn.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * 0.25;
      const y = (e.clientY - (r.top + r.height / 2)) * 0.35;
      navBtn.style.transform = `translate(${x}px, ${y}px)`;
    });
    navBtn.addEventListener('mouseleave', () => { navBtn.style.transform = ''; });
  }

  // 3. MOBILE MENU TOGGLE
  const menuToggle = document.getElementById('menuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileLinks = document.querySelectorAll('.mobile-link, .mobile-btn');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('active');
      mobileMenu.classList.toggle('open');
      document.body.style.overflow = mobileMenu.classList.contains('open') ? 'hidden' : '';
    });

    mobileLinks.forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // 4. HERO ROLE FLIPPER ANIMATION
  const roles = ["Freelancer", "Designer", "Developer"]; // not "Consultant": the title's last line already says it
  const roleFlipper = document.getElementById('roleFlipper');
  let currentRoleIndex = 0;

  if (roleFlipper) {
    setInterval(() => {
      roleFlipper.style.opacity = '0';
      roleFlipper.style.transform = 'translateY(-15px)';

      setTimeout(() => {
        currentRoleIndex = (currentRoleIndex + 1) % roles.length;
        roleFlipper.textContent = roles[currentRoleIndex];
        roleFlipper.style.transform = 'translateY(15px)';

        setTimeout(() => {
          roleFlipper.style.opacity = '1';
          roleFlipper.style.transform = 'translateY(0)';
        }, 50);
      }, 300);
    }, 2400);
  }

  // 5. 3D CARD TILT ON SERVICES
  const tiltCards = document.querySelectorAll('.creative-service-card');
  tiltCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -7;
      const rotateY = ((x - centerX) / centerX) * 7;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)';
    });
  });

  // 6. SCROLL REVEAL & SKILL PROGRESS BARS
  const skillBars = document.querySelectorAll('.skill-progress');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        skillBars.forEach(bar => {
          const pct = bar.style.getPropertyValue('--pct');
          bar.style.width = pct;
        });
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  const aboutSection = document.querySelector('.about-section');
  if (aboutSection) {
    observer.observe(aboutSection);
  }

  // 7. BACK TO TOP BUTTON
  const backToTop = document.getElementById('backToTop');
  if (backToTop) {
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // 8. CONTACT FORM SUBMISSION
  const contactForm = document.getElementById('contactForm');
  const successMsg = document.getElementById('formSuccessMessage');
  const submitBtn = document.getElementById('submitBtn');

  if (contactForm && successMsg && submitBtn) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitBtn.innerHTML = 'Sending...';
      submitBtn.disabled = true;

      setTimeout(() => {
        contactForm.style.display = 'none';
        successMsg.classList.remove('hidden');
      }, 1000);
    });
  }

});