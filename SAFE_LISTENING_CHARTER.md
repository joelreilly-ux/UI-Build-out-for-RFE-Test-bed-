# RFE Safe Listening Charter

RFE is experimental sound software. Its creative graph may be unstable; its physical-output path must remain bounded and independently protected.

1. Hardware is never used as the test limiter. Failure thresholds are investigated with deterministic digital fixtures, not speakers or hearing.
2. Experimental DSP and routing are treated as untrusted upstream input to one non-bypassable final safety boundary.
3. Digital level and acoustic level are different measurements. RFE reports sample peak in dBFS, never SPL, dBA, or dBC without calibrated physical measurement.
4. New extreme or dense structures begin at conservative application and physical monitor levels.
5. Limiter intervention is diagnostic evidence, not a normal loudness target. Repeated limiting or overload requires investigation.
6. Physical interface/monitor gain remains conservative during experimental commissioning and is independent of software protection.
7. Unknown distortion means stop, mute, and investigate; never increase level to diagnose it.
8. Dangerous or recursive routing requires explicit future opt-in and must remain upstream of final protection.
9. Gallery/installation output will be commissioned separately with calibrated acoustic measurement and an installation-specific output policy.
10. No creative requirement may bypass the final hardware-output safety boundary.

The current 50 Hz–10 kHz oscillator range is a conservative development/commissioning range, not a safe-frequency claim. The -6 dBFS sample ceiling reduces digital risk but does not guarantee speaker or hearing safety, control acoustic SPL, or measure inter-sample true peak.
