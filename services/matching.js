export function scoreCandidate(myProfile, myExperiences, mySkillsSet, candidate) {
  let score = 0;
  if (!candidate.profile) return 0;

  if (candidate.profile.filiere === myProfile.filiere) score += 6;

  const candSkills = (candidate.profile.centres_interet || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const candSkillsSet = new Set(candSkills);
  let overlap = 0;
  for (const s of mySkillsSet) if (candSkillsSet.has(s)) overlap++;
  score += Math.min(overlap, 6);

  const myTitles = new Set(myExperiences.map(e => (e.poste || "").toLowerCase()));
  const candTitleHit = candidate.experiences.some(e => myTitles.has((e.poste || "").toLowerCase()));
  if (candTitleHit) score += 3;

  return score;
}