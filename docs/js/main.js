/* ═══════════════════════════════════════════════════════
   Loom Website — Interactions
   ═══════════════════════════════════════════════════════ */

;(function () {
  'use strict'

  /* ── Nav scroll effect ── */
  const nav = document.getElementById('nav')
  let lastScroll = 0

  function handleScroll() {
    const y = window.scrollY
    if (nav) {
      nav.classList.toggle('scrolled', y > 40)
    }
    lastScroll = y
  }

  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll() // initial state

  /* ── Mobile nav toggle ── */
  const toggle = document.getElementById('navToggle')
  const links = document.getElementById('navLinks')

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open')
      // Animate hamburger → X
      const isOpen = links.classList.contains('open')
      toggle.innerHTML = isOpen
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
    })

    // Close on link click
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        links.classList.remove('open')
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
      })
    })
  }


  /* ── Scroll-reveal (IntersectionObserver) ── */
  const revealElements = document.querySelectorAll('.reveal')

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            observer.unobserve(entry.target) // Only animate once
          }
        })
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -60px 0px',
      }
    )

    revealElements.forEach(el => observer.observe(el))
  } else {
    // Fallback: show everything
    revealElements.forEach(el => el.classList.add('visible'))
  }


  /* ── Smooth scroll for anchor links ── */
  document.querySelectorAll('a[href*="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href')
      if (!href) return

      // Only handle same-page anchors
      const hashIndex = href.indexOf('#')
      const hash = href.substring(hashIndex)
      const pagePath = href.substring(0, hashIndex)

      // If clicking from same page or no page path
      if (!pagePath || pagePath === window.location.pathname.split('/').pop()) {
        const target = document.querySelector(hash)
        if (target) {
          e.preventDefault()
          const navHeight = nav ? nav.offsetHeight : 0
          const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 20
          window.scrollTo({ top, behavior: 'smooth' })
        }
      }
    })
  })


  /* ── Parallax blobs on mouse move ── */
  const blobs = document.querySelectorAll('.hero-blob')
  if (blobs.length > 0) {
    document.addEventListener('mousemove', (e) => {
      const cx = e.clientX / window.innerWidth - 0.5
      const cy = e.clientY / window.innerHeight - 0.5

      blobs.forEach((blob, i) => {
        const speed = (i + 1) * 15
        const x = cx * speed
        const y = cy * speed
        blob.style.transform = `translate(${x}px, ${y}px)`
      })
    })
  }


  /* ── Active nav link highlight ── */
  function setActiveNav() {
    const path = window.location.pathname.split('/').pop() || 'index.html'
    const hash = window.location.hash

    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active')
      const href = link.getAttribute('href')
      if (href === path || (path === '' && href === 'index.html')) {
        link.classList.add('active')
      }
    })
  }

  setActiveNav()

})()
