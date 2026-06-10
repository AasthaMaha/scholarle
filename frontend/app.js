(function () {
  "use strict";

  var API_BASE =
    window.location.protocol === "file:"
      ? "http://localhost:8000"
      : "";

  var PREV_KEY = "scholarle_prev_readiness";

  var session = { name: "", email: "" };
  var analyseCount = 0;

  var READINESS_DIMS = [
    { key: "opportunity_fit", name: "Opportunity Fit" },
    { key: "evidence_strength", name: "Evidence Strength" },
    { key: "narrative_quality", name: "Narrative Quality" },
    { key: "authenticity", name: "Authenticity" },
    { key: "competitiveness", name: "Competitiveness" },
    { key: "revision_progress", name: "Revision Progress", isProgress: true },
  ];

  var EXAMPLE = {
    cv:
      "Maya Thompson — Student Profile\n\n" +
      "Academics:\n" +
      "- Senior at Lincoln High School\n" +
      "- GPA: 3.8 (unweighted)\n" +
      "- Relevant coursework: AP Computer Science A, AP Calculus AB, AP Physics 1\n\n" +
      "Activities and Leadership:\n" +
      "- Founder and president of the school Coding Club (2 years), grew membership from 6 to 34 students\n" +
      "- Organized a weekend workshop teaching basic web design to 20 middle school students at the local community center\n" +
      "- Captain of the robotics team that reached the regional finals\n\n" +
      "Projects:\n" +
      "- Built a web app that lets students report broken equipment in school labs; adopted by the science department and reduced repair reporting time\n" +
      "- Created a tutorial series on introductory Python for the Coding Club\n\n" +
      "Goals: Plans to major in Computer Science; interested in using software to improve access to education.\n" +
      "Skills: Python, JavaScript, basic HTML/CSS, public speaking and teaching.",
    essay:
      "When the science labs at my school kept having broken equipment that nobody fixed for weeks, I decided to do something about it. I noticed that teachers were writing repair requests on sticky notes that often got lost, so I built a small web app where anyone could report a broken item and track its status.\n\n" +
      "I taught myself enough JavaScript over a few weekends to get it working, and I asked the science department to try it. After they started using it, repairs got logged in one place and things got fixed faster.\n\n" +
      "This project taught me that technology only matters if real people actually use it, so I spent as much time talking to teachers as I did writing code. In college I want to keep building tools that make everyday school life work better, and I hope to study Computer Science to do it well.",
    scholarship: "Future Leaders STEM Scholarship",
    type: "Merit-based",
    prompt:
      "The Future Leaders STEM Scholarship awards $5,000 to a high school senior who demonstrates academic excellence, leadership, and a commitment to using science or technology to improve their community.\n\n" +
      "Essay Prompt: Describe a time you used science, technology, engineering, or math to solve a real problem in your school or community. What did you learn, and how will you build on it in college? (500–650 words)\n\n" +
      "Selection criteria: genuine leadership, measurable community impact, clear and authentic writing, and a strong fit between the applicant's goals and a STEM future.",
  };

  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function show(view) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.remove("active");
    });
    $("#" + view).classList.add("active");
    window.scrollTo(0, 0);
  }

  function esc(str) {
    return String(str || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/);
    if (!parts[0]) return "?";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function levelClass(level) {
    var l = String(level || "").toLowerCase();
    if (l.indexOf("strong") !== -1) return "good";
    if (l.indexOf("develop") !== -1 || l.indexOf("emerg") !== -1) return "mid";
    return "bad";
  }

  function barClass(score) {
    if (score >= 80) return "good";
    if (score >= 60) return "mid";
    return "bad";
  }

  function wordCount(str) {
    str = str.trim();
    return str ? str.split(/\s+/).length : 0;
  }

  function loadPreviousReadiness() {
    try {
      return JSON.parse(localStorage.getItem(PREV_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveReadiness(readiness) {
    var flat = {};
    READINESS_DIMS.forEach(function (d) {
      if (d.isProgress) return;
      var entry = readiness[d.key];
      if (entry && entry.score != null) flat[d.key] = entry.score;
    });
    localStorage.setItem(PREV_KEY, JSON.stringify(flat));
  }

  function updateMeta(id, metaId) {
    var n = wordCount($("#" + id).value);
    $("#" + metaId).textContent = n ? n + (n === 1 ? " word pasted" : " words pasted") : "";
  }

  function showApiError(message) {
    var el = $("#err-api");
    if (!message) {
      el.textContent = "";
      el.classList.remove("show");
      return;
    }
    el.textContent = message;
    el.classList.add("show");
  }

  function parseApiError(data) {
    var detail = data && data.detail;
    if (!detail) return "Coaching failed. Please try again.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map(function (item) {
          return item.msg || item.message || String(item);
        })
        .join(" ");
    }
    if (detail.message) {
      return [detail.message].concat(detail.errors || []).join(" ");
    }
    return "Coaching failed. Please try again.";
  }

  function resetAnalyseButton() {
    var btn = $("#btn-analyse");
    btn.disabled = false;
    btn.innerHTML =
      '<span class="btn-icon">✦</span><span class="btn-text">' +
      (analyseCount > 0 ? "Get coaching again" : "Get coaching") +
      "</span>";
  }

  $("#btn-login").addEventListener("click", function () {
    var name = $("#in-name").value.trim();
    var email = $("#in-email").value.trim();
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    $("#err-name").classList.toggle("show", !name);
    $("#err-email").classList.toggle("show", !emailOk);
    if (!name || !emailOk) return;

    session.name = name;
    session.email = email;

    $("#pill-name").querySelector("span:last-child").textContent = name;
    $("#pill-email").querySelector("span:last-child").textContent = email;
    $("#chip-email").textContent = email;
    $("#chip-avatar").textContent = initials(name);

    show("view-app");
  });

  ["in-name", "in-email"].forEach(function (id) {
    $("#" + id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("#btn-login").click();
    });
  });

  $("#in-cv").addEventListener("input", function () {
    updateMeta("in-cv", "meta-cv");
    if ($("#in-cv").value.trim()) $("#err-uploads").classList.remove("show");
  });
  $("#in-essay").addEventListener("input", function () {
    updateMeta("in-essay", "meta-essay");
    if ($("#in-essay").value.trim()) $("#err-uploads").classList.remove("show");
  });

  $("#btn-example").addEventListener("click", function () {
    $("#in-cv").value = EXAMPLE.cv;
    $("#in-essay").value = EXAMPLE.essay;
    $("#in-scholarship").value = EXAMPLE.scholarship;
    $("#in-type").value = EXAMPLE.type;
    $("#in-prompt").value = EXAMPLE.prompt;
    updateMeta("in-cv", "meta-cv");
    updateMeta("in-essay", "meta-essay");
    $("#err-uploads").classList.remove("show");
    $("#err-details").classList.remove("show");
    showApiError("");
  });

  $("#btn-analyse").addEventListener("click", function () {
    var scholarship = $("#in-scholarship").value.trim();
    var type = $("#in-type").value;
    var prompt = $("#in-prompt").value.trim();
    var cv = $("#in-cv").value.trim();
    var essay = $("#in-essay").value.trim();

    var uploadsOk = cv && essay;
    var detailsOk = scholarship && type && prompt;

    $("#err-uploads").classList.toggle("show", !uploadsOk);
    $("#err-details").classList.toggle("show", !detailsOk);
    showApiError("");

    if (!uploadsOk || !detailsOk) return;

    var btn = $("#btn-analyse");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span class="btn-text">Coaching…</span>';

    fetch(API_BASE + "/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cv_text: cv,
        essay_text: essay,
        scholarship_name: scholarship,
        scholarship_type: type,
        prompt: prompt,
        previous_readiness: loadPreviousReadiness(),
        draft_number: analyseCount + 1,
      }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(parseApiError(data));
          }
          return data;
        });
      })
      .then(function (data) {
        analyseCount += 1;
        if (data.readiness_index) saveReadiness(data.readiness_index);
        renderResults(scholarship, data);
        $("#left-foot").style.display = "block";
      })
      .catch(function (err) {
        var msg = err.message || "Could not reach the coaching service.";
        if (
          window.location.protocol === "file:" &&
          (msg === "Failed to fetch" || msg.indexOf("NetworkError") !== -1)
        ) {
          msg =
            "Backend not running. In the project folder run: python server.py — then try again.";
        }
        showApiError(msg);
      })
      .finally(function () {
        resetAnalyseButton();
      });
  });

  function buildReadinessRow(dim, entry) {
    entry = entry || { score: 0, level: "—", coaching: "" };
    var score = entry.score != null ? entry.score : 0;
    var barW = dim.isProgress ? Math.min(100, Math.max(0, 50 + (entry.delta || 0))) : score;
    var displayScore = dim.isProgress
      ? entry.level || (entry.delta > 0 ? "+" + entry.delta : String(entry.delta || "—"))
      : score;

    return (
      '<div class="readiness-row">' +
      '<div class="readiness-top">' +
      '<span class="readiness-name">' +
      esc(dim.name) +
      "</span>" +
      '<span class="readiness-level level-' +
      levelClass(entry.level) +
      '">' +
      esc(entry.level || "—") +
      "</span>" +
      '<span class="readiness-score">' +
      esc(displayScore) +
      (dim.isProgress ? "" : '<span class="ms-den">/100</span>') +
      "</span>" +
      "</div>" +
      '<div class="metric-bar-track"><div class="metric-bar-fill bar-' +
      barClass(barW) +
      '" data-w="' +
      barW +
      '"></div></div>' +
      (entry.coaching
        ? '<p class="readiness-coaching">' + esc(entry.coaching) + "</p>"
        : "") +
      "</div>"
    );
  }

  function buildReviewerCard(item) {
    return (
      '<div class="reviewer-card">' +
      '<p class="reviewer-persona">' +
      esc(item.persona) +
      "</p>" +
      '<p class="reviewer-comment">' +
      esc(item.comment) +
      "</p>" +
      "</div>"
    );
  }

  function buildCoachPanel(title, body, highlight) {
    if (!body) return "";
    var highlightHtml = highlight
      ? '<p class="coach-highlight">' + esc(highlight) + "</p>"
      : "";
    return (
      '<div class="panel coach-panel">' +
      '<p class="panel-title">' +
      esc(title) +
      "</p>" +
      '<p class="metric-feedback">' +
      esc(body) +
      "</p>" +
      highlightHtml +
      "</div>"
    );
  }

  function renderResults(scholarshipName, data) {
    var brief = data.coaching_brief || {};
    var readiness = data.readiness_index || {};
    var growth = data.growth_report || {};
    var reports = data.coaching_reports || {};
    var reviewers = data.reviewer_comments || [];

    var strengthLevel = brief.current_strength_level || "Developing";
    var strengthClass = levelClass(strengthLevel);

    var actionHero =
      '<div class="panel action-hero">' +
      '<div class="label">What to do next</div>' +
      '<p class="action-headline">' +
      esc(brief.recommended_action || "Revise using the coaching below.") +
      "</p>" +
      '<div class="action-meta">' +
      '<span class="action-chip chip-' +
      strengthClass +
      '">Current level: ' +
      esc(strengthLevel) +
      "</span>" +
      (brief.expected_improvement
        ? '<span class="action-chip">Expected impact: ' +
          esc(brief.expected_improvement) +
          "</span>"
        : "") +
      "</div>" +
      (brief.biggest_opportunity
        ? '<p class="action-opportunity"><strong>Biggest opportunity:</strong> ' +
          esc(brief.biggest_opportunity) +
          "</p>"
        : "") +
      (brief.coach_message || data.feedback
        ? '<p class="coach-message">' +
          esc(brief.coach_message || data.feedback) +
          "</p>"
        : "") +
      '<div class="draft-meta">' +
      esc(scholarshipName) +
      " · Draft " +
      (data.draft_number || analyseCount) +
      "</div>" +
      "</div>";

    var growthHtml = "";
    if (growth.has_previous_draft && growth.improvements && growth.improvements.length) {
      growthHtml =
        '<div class="panel growth-panel">' +
        '<p class="panel-title">Your progress</p>' +
        '<ul class="priority-list">' +
        growth.improvements
          .map(function (item) {
            return "<li>" + esc(item) + "</li>";
          })
          .join("") +
        "</ul>" +
        (growth.growth_message
          ? '<p class="readiness-coaching">' + esc(growth.growth_message) + "</p>"
          : "") +
        "</div>";
    } else if (growth.growth_message) {
      growthHtml =
        '<div class="panel growth-panel">' +
        '<p class="panel-title">Growth tracking</p>' +
        '<p class="readiness-coaching">' +
        esc(growth.growth_message) +
        "</p></div>";
    }

    var readinessHtml =
      '<div class="panel">' +
      '<p class="panel-title">Application Readiness Index</p>' +
      '<div class="readiness-list">' +
      READINESS_DIMS.map(function (d) {
        return buildReadinessRow(d, readiness[d.key]);
      }).join("") +
      "</div></div>";

    var reviewersHtml = reviewers.length
      ? '<div class="panel"><p class="panel-title">Reviewer committee simulation</p><div class="reviewer-grid">' +
        reviewers.map(buildReviewerCard).join("") +
        "</div></div>"
      : "";

    var strategy = reports.strategy || {};
    var discovery = reports.discovery || {};
    var narrative = reports.narrative || {};

    var coachesHtml =
      buildCoachPanel(
        "Opportunity strategy",
        strategy.strategic_insight,
        strategy.reflection_vs_story_ratio
      ) +
      buildCoachPanel(
        "Experience discovery",
        discovery.coaching_message,
        discovery.recommended_experience_to_feature
          ? "Lead with: " + discovery.recommended_experience_to_feature
          : ""
      ) +
      buildCoachPanel(
        "Narrative coach",
        narrative.overall_narrative_coaching,
        narrative.biggest_narrative_gap
      );

    var html =
      '<div class="results-wrap">' +
      actionHero +
      growthHtml +
      readinessHtml +
      reviewersHtml +
      coachesHtml +
      "</div>";

    var results = $("#results");
    results.innerHTML = html;
    $("#empty-state").style.display = "none";
    results.style.display = "block";

    requestAnimationFrame(function () {
      setTimeout(function () {
        results.querySelectorAll("[data-w]").forEach(function (el) {
          el.style.width = el.getAttribute("data-w") + "%";
        });
      }, 60);
    });
  }
})();
