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

function Recommendations() {
    const [exams, setExams] = useState([]);
    const [error, setError] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        const fetchRecommendations = async () => {
            try {
                const response = await api.get("exams/recommend");
                setExams(response.data.data || []);
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
