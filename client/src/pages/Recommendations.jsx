import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import "./Recommendations.css";

function formatOpeningIn(days) {
    if (days > 30) {
        const months = Math.round(days / 30);
        return `Opening in ~${months} month${months === 1 ? "" : "s"}`;
    }
    return `Opening in ${days} day${days === 1 ? "" : "s"}`;
}

// Freshness TTL countdown supplied by the server for verified records.
function freshnessNote(exam) {
    const days = exam.freshness?.daysUntilExpiry;
    if (typeof days !== "number") return "";
    return exam.freshness?.status === "STALE"
        ? ` · ${Math.abs(days)}d overdue`
        : ` · re-check in ${days}d`;
}

function Recommendations() {
    const [exams, setExams] = useState([]);
    const [verificationCounts, setVerificationCounts] = useState({ verified: 0, needsVerification: 0 });
    const [error, setError] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        const fetchRecommendations = async () => {
            try {
                const response = await api.get("exams/recommend");
                setExams(response.data.data || []);
                setVerificationCounts({
                    verified: response.data.verifiedCount || 0,
                    needsVerification: response.data.needsVerificationCount || 0,
                });
            } catch (error) {
                // WHY: removed the original alert() popup; show an inline error instead.
                setError(error.response?.data?.message || "Failed to load recommendations.");
            }
        };

        fetchRecommendations();
    }, []);

    return (
        <div className="recommendations-page">
            <h1>Recommended Exams</h1>
            {error && <p className="recommendations-list__error">{error}</p>}
            {!error && exams.length > 0 && (
                <aside className="recommendations-freshness" role="status">
                    <strong>Check official details before applying.</strong>
                    <span>
                        {verificationCounts.verified} recently verified · {verificationCounts.needsVerification} need a freshness check.
                        Older or unverified matches remain visible so you can explore every opportunity.
                    </span>
                </aside>
            )}
            <div className="recommendations-list">
                {exams.map((exam) => (
                    <article key={exam._id} className="exam-card">
                        <div className="exam-card__header">
                            <h2 className="exam-card__title">{exam.name}</h2>
                            <button
                                type="button"
                                className="exam-card__details-btn"
                                onClick={() => navigate(`/exams/${exam._id}`)}
                            >
                                View Details
                            </button>
                        </div>

                        <div className="exam-card__meta">
                            <span className="exam-card__match">
                                {exam.eligibilityConfidence === "CURRENT" ? "Verified profile match" : "Potential profile match"}
                            </span>
                            <span className={`exam-card__freshness exam-card__freshness--${exam.freshness?.status?.toLowerCase() || "unverified"}`}>
                                {exam.freshness?.status === "CURRENT"
                                    ? `Verified ${new Date(exam.freshness.lastVerifiedAt).toLocaleDateString("en-IN")}`
                                    : exam.freshness?.status === "STALE" ? "Verify eligibility and dates" : "Not yet verified"}
                                {freshnessNote(exam)}
                            </span>
                            {exam.status === "Open" && (
                                <>
                                    <span className="exam-card__status">Open</span>
                                    <span className="exam-card__meta-divider" aria-hidden="true">·</span>
                                    <span className="exam-card__timing">
                                        Closes in {exam.closingIn} day{exam.closingIn === 1 ? "" : "s"}
                                    </span>
                                </>
                            )}

                            {exam.status === "Opening Soon" && (
                                <span className="exam-card__timing">
                                    {formatOpeningIn(exam.openingIn)}
                                </span>
                            )}

                            {exam.status === "Closed" && (
                                <span className="exam-card__status">Closed</span>
                            )}
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );
}

export default Recommendations;
