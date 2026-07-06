import React from "react";

// Die face component (module scope to avoid re-creation on every render)
const DieFace: React.FC<{
  dots: number;
  transform: string;
  isRed?: boolean;
}> = ({ dots, transform, isRed = false }) => {
  const dotMap: Record<number, Array<[number, number]>> = {
    1: [[50, 50]],
    2: [
      [25, 25],
      [75, 75],
    ],
    3: [
      [25, 25],
      [50, 50],
      [75, 75],
    ],
    4: [
      [25, 25],
      [25, 75],
      [75, 25],
      [75, 75],
    ],
    5: [
      [25, 25],
      [25, 75],
      [50, 50],
      [75, 25],
      [75, 75],
    ],
    6: [
      [25, 20],
      [25, 50],
      [25, 80],
      [75, 20],
      [75, 50],
      [75, 80],
    ],
  };

  return (
    <div
      className="absolute w-full h-full bg-white border border-gray-200 rounded-xl flex items-center justify-center shadow-inner"
      style={{ transform, backfaceVisibility: "hidden" }}
    >
      <svg width="100%" height="100%" viewBox="0 0 100 100">
        {(dotMap[dots] || []).map(([cx, cy], i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={dots === 1 ? 12 : 8}
            fill={isRed ? "#ef4444" : "#374151"}
          />
        ))}
      </svg>
    </div>
  );
};

export default DieFace;
