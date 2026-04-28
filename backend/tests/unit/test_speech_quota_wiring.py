"""Static wiring checks for issue #676 Phase 2 quota enforcement.

These tests don't exercise Azure or HTTP — they verify that the quota
service is actually called from the speech endpoints. The behaviour of
the service itself is covered by tests/unit/test_analysis_quota.py.
Heavy multipart-upload integration tests would require an Azure mock
that the project doesn't currently have.
"""
import inspect

from routers import speech_assessment


class TestQuotaImported:
    def test_check_can_analyze_imported(self):
        assert hasattr(speech_assessment, "check_can_analyze")

    def test_increment_analysis_count_imported(self):
        assert hasattr(speech_assessment, "increment_analysis_count")

    def test_max_constant_imported(self):
        assert hasattr(speech_assessment, "MAX_AI_ANALYSIS_ATTEMPTS")
        assert speech_assessment.MAX_AI_ANALYSIS_ATTEMPTS == 3


class TestAssessEndpointWired:
    def test_assess_endpoint_calls_check_can_analyze(self):
        source = inspect.getsource(speech_assessment.assess_pronunciation_endpoint)
        assert (
            "check_can_analyze" in source
        ), "/assess endpoint must call check_can_analyze before Azure"

    def test_save_assessment_result_calls_increment(self):
        source = inspect.getsource(speech_assessment.save_assessment_result)
        assert (
            "increment_analysis_count" in source
        ), "save_assessment_result must increment quota counter"

    def test_assess_response_includes_quota_state(self):
        source = inspect.getsource(speech_assessment.assess_pronunciation_endpoint)
        assert (
            "ai_analysis_count" in source
        ), "/assess response must surface ai_analysis_count for frontend reconciliation"
        assert "ai_analysis_remaining" in source


class TestUploadAnalysisEndpointWired:
    def test_upload_analysis_calls_check_can_analyze(self):
        source = inspect.getsource(speech_assessment.upload_pronunciation_analysis)
        assert (
            "check_can_analyze" in source
        ), "/upload-analysis must call check_can_analyze before processing"

    def test_upload_analysis_calls_increment(self):
        source = inspect.getsource(speech_assessment.upload_pronunciation_analysis)
        assert (
            "increment_analysis_count" in source
        ), "/upload-analysis must increment quota counter on success"

    def test_upload_analysis_response_includes_quota_state(self):
        source = inspect.getsource(speech_assessment.upload_pronunciation_analysis)
        assert "ai_analysis_count" in source
        assert "ai_analysis_remaining" in source


class TestAssessmentResponseSchema:
    def test_quota_fields_optional_for_backward_compat(self):
        from routers.speech_assessment import AssessmentResponse

        fields = AssessmentResponse.model_fields
        for f in ("ai_analysis_count", "ai_analysis_remaining", "max_attempts"):
            assert f in fields, f"AssessmentResponse missing quota field {f}"
            # Optional → schema must not require it
            assert not fields[
                f
            ].is_required(), f"{f} should be optional for backward compat"
